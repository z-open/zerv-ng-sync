/**
 * 
 * Service that allows an array of data remain in sync with backend.
 * 
 * 
 * ex:
 * when there is a notification, noticationService notifies that there is something new...then the dataset get the data and notifies all its callback.
 * 
 * NOTE: 
 *  
 * 
 * Pre-Requiste:
 * -------------
 * Sync requires objects have BOTH id and revision fields/properties.
 * 
 * When the backend writes any data to the db that are supposed to be syncronized:
 * It must make sure each add, update, removal of record is timestamped.
 * It must notify the datastream (with notifyChange or notifyRemoval) with some params so that backend knows that it has to push back the data back to the subscribers (ex: the taskCreation would notify with its planId)
 * 
 * 
 */
angular
    .module('zerv.sync')
    .provider('$sync', syncProvider);

function syncProvider($syncMappingProvider) {
    var totalSub = 0;

    var debug, benchmark = true;
    var latencyInMilliSecs = 0;

    this.setDebug = function (value) {
        debug = value;
        $syncMappingProvider.setDebug(value);
    };
    this.setBenchmark = function (value) {
        benchmark = value;
    };

    /**
     *  add a delay before processing publication data to simulate network latency
     * 
     * @param <number> milliseconds
     * 
     */
    this.setLatency = function (seconds) {
        latencyInMilliSecs = seconds;
    };

    this.$get = function sync($rootScope, $pq, $socketio, $syncGarbageCollector, $syncMapping, sessionUser) {

        var publicationListeners = {},
            lastPublicationListenerUid = 0;
        var GRACE_PERIOD_IN_SECONDS = 8;
        var SYNC_VERSION = '1.2';

        listenToPublicationNotification();

        var service = {
            subscribe: subscribe,
            subscribeObject: subscribeObject,
            resolveSubscription: resolveSubscription,
            getGracePeriod: getGracePeriod,
            getIdValue: getIdValue,
            getCurrentSubscriptionCount: getCurrentSubscriptionCount
        };

        return service;

        ///////////////////////////////////
        /**
         * subscribe to publication and returns the subscription when data is available. 
         * @param publication name. on the server side, a publication shall exist. ex: magazines.sync
         * @param params   the params object passed to the subscription, ex: {magazineId:'entrepreneur'})
         * @param objectClass an instance of this class will be created for each record received.
         * returns a promise returning the subscription when the data is synced
         * or rejects if the initial sync fails to complete in a limited amount of time. 
         * 
         * to get the data from the dataSet, just dataSet.getData()
         */
        function resolveSubscription(publicationName, params, objectClass) {
            var deferred = $pq.defer();
            var sDs = subscribe(publicationName).setObjectClass(objectClass);

            // give a little time for subscription to fetch the data...otherwise give up so that we don't get stuck in a resolve waiting forever.
            var gracePeriod = setTimeout(function () {
                if (!sDs.ready) {
                    sDs.destroy();
                    logInfo('Attempt to subscribe to publication ' + publicationName + ' failed');
                    deferred.reject('SYNC_TIMEOUT');
                }
            }, GRACE_PERIOD_IN_SECONDS * 1000);

            sDs.setParameters(params)
                .waitForDataReady()
                .then(function () {
                    clearTimeout(gracePeriod);
                    deferred.resolve(sDs);
                }).catch(function () {
                    clearTimeout(gracePeriod);
                    sDs.destroy();
                    deferred.reject('Failed to subscribe to publication ' + publicationName + ' failed');
                });
            return deferred.promise;
        }

        function subscribeObject(schema, id) {
            var options = _.assign({}, schema.options);
            return subscribe(schema.publication)
                .setSingle(true)
                .setObjectClass(options.objectClass)
                .map(options.mappings)
                .setParameters({ id: id });
        }

        /**
         * 
         * for test purposes, returns the time resolveSubscription before it times out.
         */
        function getGracePeriod() {
            return GRACE_PERIOD_IN_SECONDS;
        }
        /**
         * subscribe to publication. It will not sync until you set the params.
         * 
         * @param publication name. on the server side, a publication shall exist. ex: magazines.sync
         * @param params   the params object passed to the subscription, ex: {magazineId:'entrepreneur'})
         * returns subscription
         * 
         */
        function subscribe(publicationName, scope) {
            return new Subscription(publicationName, scope);
        }



        ///////////////////////////////////
        // HELPERS

        // every sync notification comes thru the same event then it is dispatches to the targeted subscriptions.
        function listenToPublicationNotification() {
            $socketio.on(
                'SYNC_NOW',
                function (subNotification, fn) {
                    // if (subNotification.diff && !subNotification.records.length) {
                    //     // this would happen only after a lost of network connection no data received
                    //     fn('SYNCED'); // let know the backend the client was able to sync.
                    //     return $pq.resolve();
                    // }

                    logInfo('Syncing with subscription [name:' + subNotification.name + ', id:' + subNotification.subscriptionId + ' , params:' + JSON.stringify(subNotification.params) + ']. Records:' + subNotification.records.length + '[' + (subNotification.diff ? 'Diff' : 'All') + ']');
                    var listeners = publicationListeners[subNotification.name];
                    var processed = [];
                    if (listeners) {
                        for (var listener in listeners) {
                            processed.push(listeners[listener](subNotification));
                        }
                    }
                    fn('SYNCED'); // let know the backend the client was able to sync.

                    // returns a promise to know when the subscriptions have completed syncing    
                    return $pq.all(processed);
                });
        };


        // this allows a dataset to listen to any SYNC_NOW event..and if the notification is about its data.
        function addPublicationListener(streamName, callback) {
            var uid = lastPublicationListenerUid++;
            var listeners = publicationListeners[streamName];
            if (!listeners) {
                publicationListeners[streamName] = listeners = {};
            }
            listeners[uid] = callback;
            totalSub++;
            //    console.log('Added new one. remaining active publication: ' + totalSub);


            return function () {
                totalSub--;
                //    console.log('Release one. remaining active publication: ' + totalSub);
                delete listeners[uid];
            }
        }
        // ------------------------------------------------------
        // Subscription object
        // ------------------------------------------------------
        /**
         * a subscription synchronizes with the backend for any backend data change and makes that data available to a controller.
         * 
         *  When client subscribes to an syncronized api, any data change that impacts the api result WILL be PUSHed to the client.
         * If the client does NOT subscribe or stop subscribe, it will no longer receive the PUSH. 
         *    
         * if the connection is lost for a short time (duration defined on server-side), the server queues the changes if any. 
         * When the connection returns, the missing data automatically  will be PUSHed to the subscribing client.
         * if the connection is lost for a long time (duration defined on the server), the server will destroy the subscription. To simplify, the client will resubscribe at its reconnection and get all data.
         * 
         * subscription object provides 3 callbacks (add,update, del) which are called during synchronization.
         *      
         * Scope will allow the subscription stop synchronizing and cancel registration when it is destroyed. 
         *  
         * Constructor:
         * 
         * @param publication, the publication must exist on the server side
         * @param scope, by default $rootScope, but can be modified later on with attach method.
         */

        function Subscription(publication, scope) {
            var timestampField, isSyncingOn = false, destroyed,
                isSingleObjectCache, updateDataStorage, cache, isInitialPushCompleted, initialStartTime, deferredInitialization;
            var onReadyOff, formatRecord;
            var reconnectOff, publicationListenerOff, destroyOff;
            var objectClass;
            var subscriptionId;
            var mapDataFn;

            var thisSub = this;
            thisSub.$dependentSubscriptionDefinitions = [];
            var subParams = {};
            var recordStates = {};
            var innerScope; //= $rootScope.$new(true);
            var syncListener = new SyncListener();

            //  ----public----
            this.toString = toString;
            this.getPublication = getPublication;
            this.getIdb = getId;
            this.ready = false;
            this.syncOn = syncOn;
            this.syncOff = syncOff;
            this.setOnReady = setOnReady;

            this.resync = resync;

            this.onReady = onReady;
            this.onUpdate = onUpdate;
            this.onAdd = onAdd;
            this.onRemove = onRemove;

            this.getData = getData;
            this.setParameters = setParameters;
            this.getParameters = getParameters;
            this.refresh = refresh;

            this.forceChanges = forceChanges;

            this.waitForDataReady = waitForDataReady;
            this.waitForSubscriptionReady = waitForSubscriptionReady;

            this.setForce = setForce;
            this.isSyncing = isSyncing;
            this.isReady = isReady;

            this.setSingle = setSingle;
            this.isSingle = isSingle;

            this.setObjectClass = setObjectClass;
            this.getObjectClass = getObjectClass;

            this.attach = attach;
            this.destroy = destroy;

            this.isExistingStateFor = isExistingStateFor; // for testing purposes

            this.map = map;
            this.mapData = mapData;
            this.mapObjectDs = mapObjectDs;
            this.mapArrayDs = mapArrayDs;

            this.$notifyUpdateWithinDependentSubscription = $notifyUpdateWithinDependentSubscription;
            this.$createDependentSubscription = $createDependentSubscription;

            setSingle(false);

            // this will make sure that the subscription is released from servers if the app closes (close browser, refresh...)
            attach(scope || $rootScope);

            ///////////////////////////////////////////
            function getId() {
                return subscriptionId;
            }

            function getPublication() {
                return publication;
            }

            function toString() {
                return publication + '/' + JSON.stringify(subParams);
            }
            /**
             * destroy this subscription but also dependent subscriptions if any
             */
            function destroy() {
                if (destroyed) {
                    return;
                }
                destroyed = true;
                if (thisSub.$parentSubscription) {
                    logDebug('Destroying Sub Subscription(s) to ' + thisSub);
                } else {
                    logDebug('Destroying Subscription to ' + thisSub);
                }
                syncOff();
                $syncMapping.destroyDependentSubscriptions(thisSub);
                logDebug('Subscription to ' + thisSub + ' destroyed.');
            }


            /** this will be called when data is available 
             *  it means right after each sync!
             * 
             * 
             */
            function setOnReady(callback) {
                if (onReadyOff) {
                    onReadyOff();
                }
                onReadyOff = onReady(callback);
                return thisSub;
            }

            /**
             * force resyncing from scratch even if the parameters have not changed
             * 
             * if outside code has modified the data and you need to rollback, you could consider forcing a refresh with this. Better solution should be found than that.
             * 
             */
            function setForce(value) {
                if (value) {
                    // quick hack to force to reload...recode later.
                    thisSub.syncOff();
                }
                return thisSub;
            }

            /** 
             * Refresh the subscription and get the data again
             * 
             * @returns {Promise} that resolves when data is ready
             */
            function refresh() {
                setForce(true);
                return waitForDataReady();
            }
            /**
             * The following object will be built upon each record received from the backend
             * 
             * This cannot be modified after the sync has started.
             * 
             * @param classValue
             */
            function setObjectClass(classValue) {
                if (!classValue || deferredInitialization) {
                    return thisSub;
                }

                objectClass = classValue;
                formatRecord = function (record) {
                    return new objectClass(record);
                }
                setSingle(isSingleObjectCache);
                return thisSub;
            }

            function getObjectClass() {
                return objectClass;
            }

            /**
             * defines the mapping to an additional subscription which syncs a single object
             * 
             * ex: 
             *  $sync.subscribe('people.sync')
             *    .setObjectClass(Person)
             *    .mapObjectDs('people.address.sync',
             *        function (person) {
             *            return { personId: person.id };
             *        },
             *        // for each resource received via sync, this map function is executed
             *        function (address, person) {
             *            person.address = address;
             *        })
             *    .waitForSubscriptionReady();
             * 
             * @param <String> name of publication to subscribe
             * @param <function> function that returns the params for the inner subscription          
             * @param <function> for each object received for this inner subscription via sync, this map function is executed
             * @param <object> options object, check map()
             * 
             */
            function mapObjectDs(publication, paramsFn, mapFn, options) {
                $syncMapping.addSyncObjectDefinition(thisSub, publication, paramsFn, mapFn, options);
                return thisSub;
            }

            /**
             * defines the mapping to an additional subscription which syncs an array of objects
             * 
             *   TODO: Delete is not implemented yet!!!!!!!!!!!!!!!!!!
             * 
             * 
             * ex: 
             *  $sync.subscribe('people.sync')
             *    .setObjectClass(Person)
             *    .mapArrayDs('people.friends.sync',
             *        function (person) {
             *            return { personId: person.id };
             *        },
             *        function (friend, person, isDeleted) {
             *            if (isDeleted) {
             *               person.remove(friend);
             *            } else {
             *               person.addOrUpdate(friend);
             *            }
             *        })
             *    .waitForSubscriptionReady();
             *            
             * @param <String> name of publication to subscribe
             * @param <function> function that returns the params for the inner subscription          
             * @param <function> for each object received for this inner subscription via sync, this map function is executed
             * @param <object> options object, check map()
             * 
             */
            function mapArrayDs(publication, paramsFn, mapFn, options) {
                $syncMapping.addSyncArrayDefinition(thisSub, publication, paramsFn, mapFn, options);
                return thisSub;
            }


            /**
             * provide a function that will map some data/lookup to the provided object
             * 
             * ex fn = function(obj) {
             *      obj.city = someCacheLookup(obj.cityId)
             * }
             * 
             */
            function mapData(fn) {
                mapDataFn = fn;
                return thisSub;
            }

            /** 
             *  this function allows to add to the subscription multiple mapping strategies at the same time
             * 
             *  data mapping strategy
             * -----------------------
             *  {
             *    type:'data',
             *    mapFn: function(objectReceicedFromSync) {
             *                    }
             *  }
             * 
             *  array mapping strategy
             * ------------------------
             *  {
             *    type:'array',
             *    publication: 'myPub',
             *    mapFn: function(objectReceicedFromSync, objectToMapTo) {
             *                     objectToMapTo.objectProperty =  objectReceicedFromSync
             *           }
             *    paramsFn: function(objectOfTheParentSubscription) {
             *                      return {
             *                          paramOfMyPub: objectOfTheParentSubscription.someProperty
             *                      }
             *           }
             *  }
             * 
             *  object mapping strategy
             * -------------------------
             *  similar to array but type is 'object, subscription only returns one object
             * 
             * 
             *  object and array stragegies might have options:
             *  options: {
             *       notifyReady: <boolean>  (if data has changed in the subscription, the main subscription onReady is triggered)
             *       objectClass: <ClassName>  subscription class used to build the received objects
             *       mappings : <array> of definitions objects 
             *  }
             * 
             *  @param <array> array of mapping definitions
             *  @returns this subscription obj
             */
            function map(mapDefinitions) {
                if (_.isArray(mapDefinitions)) {
                    _.forEach(mapDefinitions, setMapping);
                } else {
                    setMapping(mapDefinitions);
                }
                return thisSub;

                function setMapping(def) {
                    var type = def.type ? def.type.toLowerCase() : null;
                    if (type === 'object') {
                        thisSub.mapObjectDs(def.publication, def.params || def.paramsFn, def.mapFn, def.options);
                    } else if (type === 'array') {
                        thisSub.mapArrayDs(def.publication, def.params || def.paramsFn, def.mapFn, def.options);
                    } else if (type === 'data') {
                        thisSub.mapData(def.mapFn);
                    }
                }
            }


            /**
             * map static data or subscription based data to the provided object
             * 
             * DELETE NOT TESTED !!!!!!!!!!!!
             * - if the obj is deleted, we should delete all its object subscriptions
             * - if the inner object is deleted, we should pass deleted true to mapFn, so that the mapping code provided does what it is supposed to do.
             * 
             * 
             * @param <Object> the obj is the constructed object version from the data over the network
             * @returns <Promise> returns a promise that is resolved when the object is completely mapped
             */
            function mapAllDataToObject(obj, operation) {
                return $syncMapping.mapObjectPropertiesToSubscriptionData(thisSub, obj)
                    .then(function (obj, operation) {
                        return mapDataToOject(obj, operation);
                    })
                    .catch(function (err) {
                        logError('Error when mapping received object.', err);
                        $pq.reject(err);
                    });

            }

            /** 
             * map data to the object,
             * 
             * might also be used to map this object to the parent subscription object
             * 
             * if the mapping fails, the new object version will not be merged
             * 
             * @param obj
             * @param <String> operation (add or update or remove)
             * @returns <Promise> the promise resolves when the mapping as completed
    
             * 
             */
            function mapDataToOject(obj, operation) {
                if (mapDataFn) {
                    var result = mapDataFn(obj, operation);
                    if (result && result.then) {
                        return result
                            .then(function () {
                                return obj;
                            });
                    }
                }
                return $pq.resolve(obj);
            }


            function $createDependentSubscription(publication) {
                var depSub = subscribe(publication);
                depSub.$parentSubscription = thisSub;
                return depSub;
            }


            function $notifyUpdateWithinDependentSubscription(idOfObjectImpactedByChange) {
                var cachedObject = getRecordState({ id: idOfObjectImpactedByChange });
                syncListener.notify('ready', getData(), [cachedObject]);
            }

            /**
             * this function starts the syncing.
             * Only publication pushing data matching our fetching params will be received.
             * 
             * ex: for a publication named "magazines.sync", if fetching params equalled {magazinName:'cars'}, the magazine cars data would be received by this subscription.
             * 
             * @param fetchingParams
             * @param options
             * 
             * @returns a promise that resolves when data is arrived.
             */
            function setParameters(fetchingParams, options) {
                if (isSyncingOn && angular.equals(fetchingParams || {}, subParams)) {
                    // if the params have not changed, just returns with current data.
                    return thisSub; //$pq.resolve(getData());
                }
                syncOff();
                if (!isSingleObjectCache) {
                    cache.length = 0;
                }

                subParams = fetchingParams || {};
                options = options || {};
                if (angular.isDefined(options.single)) {
                    setSingle(options.single);
                }
                startSyncing();
                return thisSub;
            }

            function getParameters() {
                return _.clone(subParams);
            }

            /**
             * Wait for the subscription to establish initial retrieval of data and returns this subscription in a promise
             * 
             * @param {function} optional function that will be called with this subscription object when the data is ready 
             * @returns {Promise} that waits for the initial fetch to complete then wait for the initial fetch to complete then returns this subscription.
             */
            function waitForSubscriptionReady(callback) {
                return startSyncing().then(function () {
                    if (callback) {
                        callback(thisSub);
                    }
                    return thisSub;
                });
            }

            /**
             * Wait for the subscription to establish initial retrieval of data and returns the data in a promise
             * 
             * @param {function} optional function that will be called with the synced data and this subscription object when the data is ready 
             * @returns {Promise} that waits for the initial fetch to complete then returns the data
             */
            function waitForDataReady(callback) {
                return startSyncing().then(function (data) {
                    if (callback) {
                        callback(data, thisSub);
                    }
                    return data;
                });
            }

            // does the dataset returns only one object? not an array?
            function setSingle(value) {
                if (deferredInitialization) {
                    return thisSub;
                }

                var updateFn;
                isSingleObjectCache = value;
                if (value) {
                    updateFn = updateSyncedObject;
                    cache = objectClass ? new objectClass({}) : {};
                } else {
                    updateFn = updateSyncedArray;
                    cache = [];
                }

                updateDataStorage = function (record) {
                    try {
                        if (record.timestamp) {
                            record.timestamp.$sync = thisSub;
                        }
                        updateFn(record);
                    } catch (e) {
                        e.message = 'Received Invalid object from publication [' + publication + ']: ' + JSON.stringify(record) + '. DETAILS: ' + e.message;
                        throw e;
                    }
                }

                return thisSub;
            }

            /**
             *  @returns true if this subscription handles single object otherwise false if an array;
             */
            function isSingle() {
                return isSingleObjectCache;
            }

            /**
             *  returns the object or array in sync
             * 
             *  Note: When the sync is set to work on a single object, the cache object would be an empty object if the record was deleted.
             * 
             *  @param {integer} id. Optional id of the record to look up otherwise returns all data available
             * 
             */
            function getData(id) {
                return !_.isNil(id) ? getCachedObject(id) : cache;
            }

            function getCachedObject(id) {
                if (isSingleObjectCache) {
                    return cache.id === id ? cache : null;
                }
                return _.find(cache, { id: id });
            }


            /**
             * Activate syncing
             *
             * @returns this subcription
             *
             */
            function syncOn() {
                startSyncing();
                return thisSub;
            }


            /**
             * Deactivate syncing
             *
             * the dataset is no longer listening and will not call any callback
             *
             * @returns this subcription
             */
            function syncOff() {
                if (deferredInitialization) {
                    // if there is code waiting on this promise.. ex (load in resolve)
                    deferredInitialization.resolve(getData());
                }
                if (isSyncingOn) {
                    unregisterSubscription();
                    isSyncingOn = false;

                    logInfo('Sync ' + publication + ' off. Params:' + JSON.stringify(subParams));
                    if (publicationListenerOff) {
                        publicationListenerOff();
                        publicationListenerOff = null;
                    }
                    if (reconnectOff) {
                        reconnectOff();
                        reconnectOff = null;
                    }
                }
                return thisSub;
            }

            /**
             * force resyncing.
             * 
             * This would clear the cache then restablish the sync to load fresh data
             *
             * @returns this subcription
             *
             */
            function resync() {
                syncOff();
                syncOn();
                return thisSub;
            }

            /**
             * the dataset will start listening to the datastream 
             * 
             * Note During the sync, it will also call the optional callbacks - after processing EACH record received.
             * 
             * @returns a promise that will be resolved when the data is ready.
             */
            function startSyncing() {
                if (isSyncingOn) {
                    return deferredInitialization.promise;
                }
                deferredInitialization = $pq.defer();
                initialStartTime = Date.now();
                isInitialPushCompleted = false;
                logInfo('Sync ' + publication + ' on. Params:' + JSON.stringify(subParams));
                isSyncingOn = true;
                registerSubscription();
                readyForListening();
                return deferredInitialization.promise;
            }

            function isSyncing() {
                return isSyncingOn;
            }

            function readyForListening() {
                if (!publicationListenerOff) {

                    // if the subscription belongs to a parent one and the network is lost, the top parent subscription will release/destroy all dependent subscriptions and take care of re-registering itself and its dependents.
                    if (!thisSub.$parentSubscription) {
                        listenForReconnectionToResync();
                    }

                    publicationListenerOff = addPublicationListener(
                        publication,
                        function (batch) {
                            // Create a delay before processing publication data to simulate network latency
                            if (latencyInMilliSecs) {
                                logInfo('Sync -> Processing delayed for ' + latencyInMilliSecs + ' ms.'); // 
                                setTimeout(function () {
                                    logInfo('Sync -> Processing ' + publication + ' now.');
                                    processPublicationData(batch);
                                }, latencyInMilliSecs);
                            } else {
                                return processPublicationData(batch);
                            }

                        }

                    );
                }
            }

            /**
             *  By default the rootscope is attached if no scope was provided. But it is possible to re-attach it to a different scope. if the subscription depends on a controller.
             *
             */
            function attach(newScope) {
                if (newScope === innerScope) {
                    return thisSub;
                }
                if (destroyOff) {
                    destroyOff();
                }
                innerScope = newScope;
                destroyOff = innerScope.$on('$destroy', function () {
                    destroy();
                });

                return thisSub;
            }

            function listenForReconnectionToResync(listenNow) {
                // give a chance to connect before listening to reconnection... @TODO should have user_reconnected_event
                setTimeout(function () {
                    reconnectOff = innerScope.$on('user_connected', function () {
                        logDebug('Resyncing after network loss to ' + publication);
                        // note the backend might return a new subscription if the client took too much time to reconnect.
                        registerSubscription();
                    });
                }, listenNow ? 0 : 2000);
            }

            function registerSubscription() {
                $socketio.fetch('sync.subscribe', {
                    version: SYNC_VERSION,
                    id: subscriptionId, // to try to re-use existing subcription
                    publication: publication,
                    params: subParams
                }).then(function (subId) {
                    subscriptionId = subId;
                });
            }

            function unregisterSubscription() {
                if (subscriptionId) {
                    $socketio.fetch('sync.unsubscribe', {
                        version: SYNC_VERSION,
                        id: subscriptionId,
                        // following only useful for unit testing
                        publication: publication,
                        params: subParams
                    });
                    subscriptionId = null;
                }
            }

            /**
             * each subscription listens to any data coming from the sync socket channel
             * If any is related to it, it will process to update the internal cache
             *
             */
            function processPublicationData(batch) {
                // cannot only listen to subscriptionId yet...because the registration might have answer provided its id yet...but started broadcasting changes...@TODO can be improved...
                if (subscriptionId === batch.subscriptionId || (!subscriptionId && checkDataSetParamsIfMatchingBatchParams(batch.params))) {
                    var applyPromise;

                    var startTime = Date.now();
                    var size = benchmark && debug ? JSON.stringify(batch.records).length : null;

                    if (!batch.diff && isDataCached()) {
                        // Clear the cache to rebuild it if all data was received.
                        applyPromise = clearCache()
                            .then(function () {
                                return applyChanges(batch.records);
                            });
                    } else {
                        applyPromise = applyChanges(batch.records);
                    }
                    return applyPromise.then(
                        function () {
                            if (!isInitialPushCompleted) {
                                isInitialPushCompleted = true;

                                if (benchmark && debug) {
                                    var timeToReceive = Date.now() - initialStartTime;
                                    var timeToProcess = Date.now() - startTime;
                                    logInfo('Initial sync total time for ' + publication + ': ' + (timeToReceive + timeToProcess) + 'ms - Data Received in: ' + timeToReceive + 'ms, applied in: ' + timeToProcess + 'ms - Estimated size: ' + formatSize(size) + ' - Records: ' + batch.records.length + ' - Avg size/time: ' + formatSize(size / (batch.records.length || 1)) + '/' + roundNumber(timeToProcess / (batch.records.length || 1), 2) + 'ms');
                                }

                                deferredInitialization.resolve(getData());
                            }
                        }
                    )
                }
                // unit test will know when the apply is completed when the promise resolve;
                return $pq.resolve();
            }


            /**
             * @return {boolean} true if record states are in memory, it implied data has been cached.
             */
            function isDataCached() {
                return Object.keys(recordStates).length > 0;
            }

            /**
             * this releases all objects currently in the cache 
             * 
             * if they have dependent subscriptions, they will be released.
             * 
             * the mapAllDataObject will be called on each object to make sure object can unmapped if necessary
             * 
             * 
             */
            function clearCache() {
                var result;
                if (!isSingleObjectCache) {
                    result = clearArrayCache();
                } else {
                    result = clearObjectCache();
                }
                return result.catch(function (err) {
                    logError('Error clearing subscription cache - ' + err);
                })
            }

            function clearArrayCache() {
                var promises = [];
                _.forEach(cache, function (obj) {
                    $syncMapping.removePropertyMappers(thisSub, obj);
                    obj.removed = true;
                    promises.push(mapDataToOject(obj));
                });
                return $pq.all(promises).finally(function () {
                    recordStates = {};
                    cache.length = 0;
                });
            }

            function clearObjectCache() {
                $syncMapping.removePropertyMappers(thisSub, cache);
                cache.removed = true;
                recordStates = {};
                return mapDataToOject(cache);
            }
            /**
             * if the params of the dataset matches the notification, it means the data needs to be collect to update array.
             */
            function checkDataSetParamsIfMatchingBatchParams(batchParams) {
                // if (params.length != streamParams.length) {
                //     return false;
                // }
                if (!subParams || Object.keys(subParams).length == 0) {
                    return true
                }
                var matching = true;
                for (var param in batchParams) {
                    // are other params matching?
                    // ex: we might have receive a notification about taskId=20 but this subscription are only interested about taskId-3
                    if (batchParams[param] !== subParams[param]) {
                        matching = false;
                        break;
                    }
                }
                return matching;

            }

            /** 
             * Force the provided records into the cache
             * And activate the call backs (ready, add,update,remove)
             * 
             * The changes might be overwritten by next sync/publication. To prevent this, sync off should be called first.
             * 
             * @param <array> records is an array of data record (json obj) 
             * @returns <promise> that resolves when the changes are applied to the cache
             */
            function forceChanges(records) {
                return applyChanges(records, true);
            }

            /**
             *  fetch all the missing records, and activate the call backs (add,update,remove) accordingly if there is something that is new or not already in sync.
             * 
             * @param <array> records is an array of data record (json obj)
             * @param <boolean> force, forces the data into the cache even whatever is the record revision.
             * 
             */
            function applyChanges(records, force) {
                thisSub.ready = false;
                return waitForExternalDatasourcesReady()
                    .then(function () {
                        try {
                            var newDataArray = [];
                            var promises = [];
                            records.forEach(function (record) {
                                //                   logInfo('Datasync [' + dataStreamName + '] received:' +JSON.stringify(record));//+ JSON.stringify(record.id));
                                if (record.remove) {
                                    promises.push(removeRecord(record, force));
                                } else if (getRecordState(record)) {
                                    // if the record is already present in the cache...so it is mightbe an update..
                                    promises.push(updateRecord(record, force).then(function (newData) {
                                        newDataArray.push(newData);
                                    }));
                                } else {
                                    // if the record is already present in the cache...so it is mightbe an update..
                                    promises.push(addRecord(record, force).then(function (newData) {
                                        newDataArray.push(newData);
                                    }));
                                }
                            });
                            return $pq.all(promises).then(function () {
                                return newDataArray;
                            });
                        }
                        catch (err) {
                            // angular does not reject automatically!! not sure why.
                            return $pq.reject(err);
                        }
                    })
                    // TODO: Investigate could be a scenario where those promises never resolve or fail?????
                    .then(notifyDataReady);
            }

            function waitForExternalDatasourcesReady() {
                return {
                    then: function (cb) {
                        return cb();
                    }
                };//$pq.resolve();
            }

            function notifyDataReady(newDataArray) {
                thisSub.ready = true;
                if (isSingleObjectCache) {
                    syncListener.notify('ready', getData());
                } else {
                    syncListener.notify('ready', getData(), newDataArray);
                }
            }


            /**
             * Although most cases are handled using onReady, this tells you the current data state.
             * 
             * @returns if true is a sync has been processed otherwise false if the data is not ready.
             */
            function isReady() {
                return thisSub.ready;
            }
            /**
             * 
             * returns a function to remove the listener.
             */
            function onAdd(callback) {
                return syncListener.on('add', callback);
            }

            /**
             * 
             * returns a function to remove the listener.
             */
            function onUpdate(callback) {
                return syncListener.on('update', callback);
            }

            /**
             * 
             * returns a function to remove the listener.
             */
            function onRemove(callback) {
                return syncListener.on('remove', callback);
            }

            /**
             * 
             * returns a function to remove the listener.
             */
            function onReady(callback) {
                return syncListener.on('ready', callback);
            }


            function addRecord(record, force) {
                logDebug('Sync -> Inserted New record #' + JSON.stringify(record.id) + (force ? ' directly' : ' via sync') + ' for subscription to ' + thisSub); // JSON.stringify(record));
                getRevision(record); // just make sure we can get a revision before we handle this record

                var obj = formatRecord ? formatRecord(record) : record;

                return mapAllDataToObject(obj, 'add').then(function () {
                    updateDataStorage(obj);
                    syncListener.notify('add', obj);
                    return obj;
                });
            }


            function updateRecord(record, force) {
                var previous = getRecordState(record);
                if (!force & getRevision(record) <= getRevision(previous)) {
                    return $pq.resolve();
                }

                // has Sync received a record whose version was originated locally?
                var obj = isSingleObjectCache ? cache : previous;
                if (isLocalChange(obj, record)) {
                    logDebug('Sync -> Updated own record #' + JSON.stringify(record.id) + ' for subscription to ' + thisSub);
                    _.assign(obj.timestamp, record.timestamp);
                    obj.revision = record.revision;
                    previous.revision = record.revision;
                    return $pq.resolve(obj);
                }

                logDebug('Sync -> Updated record #' + JSON.stringify(record.id) + (force ? ' directly' : ' via sync') + ' for subscription to ' + thisSub);
                obj = formatRecord ? formatRecord(record) : record;

                return mapAllDataToObject(obj, 'update').then(function () {
                    updateDataStorage(obj);
                    syncListener.notify('update', obj);
                    return obj;
                });
            }


            function removeRecord(record, force) {
                var previous = getRecordState(record);

                if (force || !previous || getRevision(record) > getRevision(previous)) {
                    logDebug('Sync -> Removed #' + JSON.stringify(record.id) + (force ? ' directly' : ' via sync') + ' for subscription to ' + thisSub);
                    // We could have for the same record consecutively fetching in this order:
                    // delete id:4, rev 10, then add id:4, rev 9.... by keeping track of what was deleted, we will not add the record since it was deleted with a most recent timestamp.
                    record.removed = true; // So we only flag as removed, later on the garbage collector will get rid of it.       

                    // if there is no previous record we do not need to removed any thing from our storage.     
                    if (previous) {
                        updateDataStorage(record);
                        $syncMapping.removePropertyMappers(thisSub, record);
                        syncListener.notify('remove', record);
                        dispose(record);
                        return mapDataToOject(previous, true);
                    }
                }
                return $pq.resolve(record);
            }

            function dispose(record) {
                $syncGarbageCollector.dispose(function collect() {
                    var existingRecord = getRecordState(record);
                    if (existingRecord && record.revision >= existingRecord.revision) {
                        //logDebug('Collect Now:' + JSON.stringify(record));
                        delete recordStates[getIdValue(record.id)];
                    }
                });
            }

            function isExistingStateFor(record) {
                return !!getRecordState(record);
            }

            function isLocalChange(currentInCache, update) {
                return currentInCache.timestamp && update.timestamp &&
                    update.timestamp.sessionId === sessionUser.sessionId && currentInCache.timestamp.sessionId === sessionUser.sessionId && currentInCache.timestamp.$isLocalUpdate;
            }

            function saveRecordState(record) {
                recordStates[getIdValue(record.id)] = record;
            }

            /**
             * the record state contains the last version of the record receiced by sync.
             * It is useful to keep the state, as deleted record must be kept in memory for a while (before collection)
             * This will prevent readding a older version of the record.
             */
            function getRecordState(record) {
                return recordStates[getIdValue(record.id)];
            }

            function updateSyncedObject(record) {
                saveRecordState(record);

                if (!record.remove) {
                    merge(cache, record);
                } else {
                    clearObject(cache);
                }
            }

            function updateSyncedArray(record) {
                var existing = getRecordState(record);
                if (!existing) {
                    // add new instance
                    saveRecordState(record);
                    if (!record.removed) {
                        cache.push(record);
                    }
                    existing = record;
                } else {
                    merge(existing, record);
                    if (record.removed) {
                        cache.splice(cache.indexOf(existing), 1);
                    }
                }

            }

            function merge(destination, source) {
                clearObject(destination);
                _.assign(destination, source);

                // the object is attached to the subscription which maintains it;
                if (!destination.timestamp) {
                    destination.timestamp = {};
                }

            }

            function clearObject(object) {
                Object.keys(object).forEach(function (key) { delete object[key]; });
            }

            function getRevision(record) {
                // what reserved field do we use as timestamp
                if (angular.isDefined(record.revision)) {
                    return record.revision;
                }
                if (angular.isDefined(record.timestamp)) {
                    return record.timestamp;
                }
                throw new Error('Sync requires a revision or timestamp property in received ' + (objectClass ? 'object [' + objectClass.name + ']' : 'record'));
            }
        }

        /**
         * this object 
         */
        function SyncListener() {
            var events = {};
            var count = 0;

            this.notify = notify;
            this.on = on;

            function notify(event, data1, data2) {
                var listeners = events[event];
                if (listeners) {
                    _.forEach(listeners, function (callback, id) {
                        callback(data1, data2);
                    });
                }
            }

            /**
             * @returns handler to unregister listener
             */
            function on(event, callback) {
                var listeners = events[event];
                if (!listeners) {
                    listeners = events[event] = {};
                }
                var id = count++;
                listeners[id] = callback;
                return function () {
                    delete listeners[id];
                }
            }
        }
    };

    function getIdValue(id) {
        if (!_.isObject(id)) {
            return id;
        }
        // build composite key value
        var r = _.join(_.map(id, function (value) {
            return value;
        }), '~');
        return r;
    }


    function logInfo(msg) {
        if (debug >= 1) {
            console.debug('SYNC(info): ' + msg);
        }
    }

    function logDebug(msg) {
        if (debug >= 2) {
            console.debug('SYNC(debug): ' + msg);
        }
    }

    function formatSize(size) {
        return size > 1000000 ? roundNumber(size / 1000000, 3) + 'Mgb' : size > 1000 ? roundNumber(size / 1000, 3) + 'Kb' : roundNumber(size) + 'b';
    }

    function roundNumber(num, n) {
        if (!n) {
            return Math.round(num);
        }
        var d = Math.pow(10, n);
        return Math.round(num * d) / d;
    }

    function logError(msg, e) {
        if (debug >= 0) {
            console.error('SYNC(error): ' + msg, e);
        }
    }

    function getCurrentSubscriptionCount() {
        return totalSub;
    }



};