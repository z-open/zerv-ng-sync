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
    .module('sync')
    .provider('$sync', syncProvider);

function syncProvider() {
    var totalSub = 0;

    var debug;
    var defaultDeepMerge = false,
        latencyInMilliSecs = 0;

    this.setDebug = function (value) {
        debug = value;
    };

    /**
     * by default the deepMerge is used during sync, which can throw exception when syncing objects which have inner object dependency (ex the object to sync has a parent object and collection of children which point to the parent)
     * 
     * It is recommended to use this library with setDeepMerge to false.
     */
    this.setDeepMerge = function (value) {
        defaultDeepMerge = value;
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

    this.$get = function sync($rootScope, $q, $socketio, $syncGarbageCollector, $syncMerge) {

        var publicationListeners = {},
            lastPublicationListenerUid = 0;
        var GRACE_PERIOD_IN_SECONDS = 8;
        var SYNC_VERSION = '1.2';


        listenToSyncNotification();

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
            var deferred = $q.defer();
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
                .setDeepMerge(options.deepMerge)
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
        function listenToSyncNotification() {
            $socketio.on(
                'SYNC_NOW',
                function (subNotification, fn) {
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
                    return $q.all(processed);
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
            var timestampField, isSyncingOn = false,
                isSingleObjectCache, updateDataStorage, cache, isInitialPushCompleted, deferredInitialization, strictMode;
            var onReadyOff, formatRecord;
            var reconnectOff, publicationListenerOff, destroyOff;
            var objectClass;
            var subscriptionId;
            var mapDataFn;

            var thisSub = this;
            var dependentSubscriptionDefinitions = [];
            var datasources = [];
            var subParams = {};
            var recordStates = {};
            var innerScope; //= $rootScope.$new(true);
            var syncListener = new SyncListener();
            var deepMerge = defaultDeepMerge;

            //  ----public----
            this.getPublication = getPublication;
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

            this.setStrictMode = setStrictMode;
            this.setDeepMerge = setDeepMerge;

            this.attach = attach;
            this.destroy = destroy;

            this.isExistingStateFor = isExistingStateFor; // for testing purposes

            this.map = map;
            this.mapData = mapData;
            this.mapObjectDs = mapObjectDs;
            this.mapArrayDs = mapArrayDs;

            this.$notifyUpdateWithinDependentSubscription = $notifyUpdateWithinDependentSubscription;


            setSingle(false);

            // this will make sure that the subscription is released from servers if the app closes (close browser, refresh...)
            attach(scope || $rootScope);

            ///////////////////////////////////////////

            function getPublication() {
                return publication;
            }

            /**
             * destroy this subscription but also dependent subscriptions if any
             */
            function destroy() {
                syncOff();
                var allSubscriptions = _.flatten(_.map(datasources, function (datasource) {
                    return datasource.subscriptions;
                }));
                var deps = [];
                _.forEach(allSubscriptions, function (sub) {
                    deps.push(sub.getPublication());
                    sub.destroy();
                });
                deps = _.uniq(deps);
                logDebug('Destroy subscription to ' + publication + (deps.length ? ' and its ' + allSubscriptions.length + ' dependent(s) based on [' + deps + ']' : ''));
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
             * if set to true, if an object within an array property of the record to sync has no ID field.
             * an error would be thrown.
             * It is important if we want to be able to maintain instance references even for the objects inside arrays.
             *
             * Forces us to use id every where.
             *
             * Should be the default...but too restrictive for now.
             * @deprecated
             */
            function setStrictMode(value) {
                strictMode = value;
                return thisSub;
            }

            /**
             * Deep merge allows to maintain references in objects.
             *
             * But this can create circular references in objects that have inner object dependencies.
             *
             * To avoid circular references, it is recommended to use a shalow merge (false) 
             *
             * @param <boolean> false for shalow merge (default is deep merge)
             *
             */
            function setDeepMerge(value) {
                deepMerge = value;
                return thisSub;
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
                options = _.assign({}, options);
                dependentSubscriptionDefinitions.push({
                    publication: publication,
                    paramsFn: getParamsFn(paramsFn),
                    mapFn: mapFn,
                    single: true,
                    objectClass: options.objectClass,
                    mappings: options.mappings,
                    notifyReady: options.notifyReady,
                    deepMerge: options.deepMerge // legacy
                });
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
                options = _.assign({}, options);
                dependentSubscriptionDefinitions.push({
                    publication: publication,
                    paramsFn: getParamsFn(paramsFn),
                    mapFn: mapFn,
                    single: false,
                    objectClass: options.objectClass,
                    mappings: options.mappings,
                    notifyReady: options.notifyReady,
                    deepMerge: options.deepMerge // legacy

                });
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
                    if (def.type === 'object') {
                        thisSub.mapObjectDs(def.publication, def.params || def.paramsFn, def.mapFn, def.options);
                    } else if (def.type === 'array') {
                        thisSub.mapArrayDs(def.publication, def.params || def.paramsFn, def.mapFn, def.options);
                    }
                    if (def.type === 'data') {
                        thisSub.mapData(def.mapFn);
                    }
                }

            }

            /**
             * 
             *  provide the function that will returns the params to set the dependent subscription parameters
             * 
             *  @param <function> or <Map>
             *         ex of function: function(obj) {
             *              return {id:obj.ownerId};
             *         }
             *         ex of map: {id:'ownerI'} 
             *         in both example above, if ownerId was null the dependent subscription would not start.
             * 
             *  @returns <function> that will define the parameters based on the parent object subscription
             */
            function getParamsFn(fnOrMap) {
                var fn;
                if (_.isFunction(fnOrMap)) {
                    fn = fnOrMap;
                } else {
                    fn = function (obj) {
                        var mappingParams = {};
                        for (var key in fnOrMap) {
                            var v = _.get(obj, fnOrMap[key]);
                            if (!_.isNil(v)) {
                                mappingParams[key] = v;
                            }
                        }
                        return mappingParams;
                    };
                }

                return function () {
                    var mappingParams = fn.apply(this, arguments);
                    // if there is no param, there is no mapping to do, most likely, there is no need for the dependent subscription
                    // ex a person.driverLicenceId.... if that person does not have this information, there would be no need to try to subscribe
                    if (!mappingParams || !Object.keys(mappingParams).length) {
                        return null;
                    }
                    return mappingParams;
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
                return mapSubscriptionDataToObject(obj)
                    .then(function (obj, operation) {
                        return mapDataToOject(obj, operation);
                    })
                    .catch(function (err) {
                        logError('Error when mapping received object.', err);
                        $q.reject(err);
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
                return $q.resolve(obj);
            }

            /**
             * wait for the subscriptions to pull their data then update the object
             * 
             * @returns <Promise> Resolve when it completes
             */
            function mapSubscriptionDataToObject(obj) {

                if (dependentSubscriptionDefinitions.length === 0) {
                    return $q.resolve(obj);
                }

                var objectSubscriptions = findObjectDependentSubscriptions(obj);
                if (!objectSubscriptions) {
                    objectSubscriptions = createObjectDependentSubscriptions(obj);
                    // return $q.resolve();
                }


                return $q.all(_.map(objectSubscriptions,
                    function (ds) {
                        // if the ds is already ready, then the object is mapped with the datasource data
                        return ds
                            // !!!!!!!!!!!!!!!!!
                            // !!!!! must set the parameters again as the update might have caused a different subscription.
                            //     the parameter might also become null, then the subscription should stop.
                            // !!!!!!!!!!!!!!!!!
                            // not tested.setParameters(dependentSubDef.paramsFn(obj, collectParentSubscriptionParams()))
                            .waitForDataReady().then(function (data) {
                                if (ds.isSingle()) {
                                    ds.mapFn(data, obj);
                                } else {
                                    _.forEach(data, function (resultObj) {
                                        ds.mapFn(resultObj, obj);
                                    });
                                }
                            });
                    }))
                    .then(function () {
                        return obj;
                    });
            }

            /**
             * find all subscriptions linked to the current object
             * 
             *  @param <Object> the object of the cache that will be mapped with additional data from subscription when they arrived
             *  @returns all the subscriptions linked to this object
             */
            function findObjectDependentSubscriptions(obj) {
                var objDs = _.find(datasources, { objId: obj.id });
                return objDs ? objDs.subscriptions : null;
            }

            /**
             * remove the subscriptions that an object depends on if any
             * 
             *  @param <Object> the object of that was removed
             */
            function removeObjectDependentSubscriptions(obj) {
                var objDs = _.find(datasources, { objId: obj.id });
                if (objDs && objDs.subscriptions.length !== 0) {
                    logDebug('Sync -> Removing dependent subscription for record #' + obj.id + ' for subscription to ' + publication);
                    _.forEach(objDs.subscriptions, function (sub) {
                        sub.destroy();
                    });
                    var p = datasources.indexOf(objDs);
                    datasources.slice(p, p + 1);
                }
            }

            /**
             * create the dependent subscription for each object of the cache
             * 
             * TODO: no reuse at this time, we might subscribe multiple times to the same data
             * 
             *  @param <Object> the object of the cache that will be mapped with additional data from subscription when they arrived
             *  @returns all the subscriptions linked to this object
             */
            function createObjectDependentSubscriptions(obj) {
                logDebug('Sync -> creating object dependent subscription for subscription to ' + publication);
                var subscriptions = [];
                _.forEach(dependentSubscriptionDefinitions,
                    function (dependentSubDef) {

                        var subParams = dependentSubDef.paramsFn(obj, collectParentSubscriptionParams());

                        if (_.isEmpty(subParams)) {
                            return;
                        }

                        var depSub = subscribe(dependentSubDef.publication)
                            .setObjectClass(dependentSubDef.objectClass)
                            .setSingle(dependentSubDef.single)
                            .setDeepMerge(dependentSubDef.deepMerge || defaultDeepMerge)
                            .mapData(function (dependentSubObject, operation) {
                                // map will be triggered in the following conditions:
                                // - when the first time, the object is received, this dependent sync will be created and call map when it receives its data
                                // - the next time the dependent syncs

                                // if the main sync is ready, it means 
                                // - only the dependent received update 
                                // if th main sync is NOT ready, the mapping will happen anyway when running mapSubscriptionDataToObject

                                // -------------------------------------------------
                                // if (isReady() || force) { this does not work!!!  with this, it seems that mapping is not executed sometimes.
                                // 
                                // To dig in, mostlikely when the dependent subscription is created, mapFn will be called twice.
                                // Try to prevent this... 
                                // -------------------------------------------------
                                var objectToBeMapped = getData(obj.id);
                                if (objectToBeMapped) {
                                    logDebug('Sync -> mapping data [' + operation + '] of dependent sub [' + dependentSubDef.publication + '] to record of sub [' + publication + ']');
                                    // need to remove 3rd params...!!!
                                    depSub.mapFn(dependentSubObject, objectToBeMapped, dependentSubObject.removed, operation);
                                }
                                //}
                            })
                            .setOnReady(function () {
                                // if the main sync is NOT ready, it means it is in the process of being ready and will notify when it is
                                if (dependentSubDef.notifyReady && isReady()) {
                                    notifyMainSubscription(depSub);
                                }
                            });
                        depSub.mapFn = dependentSubDef.mapFn;

                        // the dependent subscription is linked to this particular object comming from a parent subscription
                        depSub.objectId = obj.id;
                        depSub.parentSubscription = thisSub;

                        // the dependent subscription might have itself some mappings
                        if (dependentSubDef.mappings) {
                            depSub.map(dependentSubDef.mappings);
                        }
                        // this starts the subscription using the params computed by the function provided when the dependent subscription was defined

                        // !!!! should not start subscription if no parameters, but what about the parameter is set.

                        subscriptions.push(depSub.setParameters(dependentSubDef.paramsFn(obj, collectParentSubscriptionParams())));
                    });
                datasources.push({
                    objId: obj.id,
                    subscriptions: subscriptions
                });
                return subscriptions;
            }



            function $notifyUpdateWithinDependentSubscription(idOfObjectImpactedByChange) {
                var cachedObject = getRecordState({ id: idOfObjectImpactedByChange });
                syncListener.notify('ready', getData(), [cachedObject]);
            }

            function notifyMainSubscription(dependentSubscription) {
                var mainObjectId = collectMainObjectId(dependentSubscription);
                var mainSub = thisSub;
                while (mainSub.parentSubscription) {
                    mainSub = mainSub.parentSubscription;
                }
                logDebug('Sync -> Notifying main subscription ' + mainSub.getPublication() + ' that its dependent subscription ' + dependentSubscription.getPublication() + ' was updated.');
                mainSub.$notifyUpdateWithinDependentSubscription(mainObjectId);
            }

            function collectMainObjectId(dependentSubscription) {
                var id;
                while (dependentSubscription && dependentSubscription.objectId) {
                    id = dependentSubscription.objectId;
                    dependentSubscription = dependentSubscription.parentSubscription;
                }
                return id;
            }

            function collectParentSubscriptionParams() {
                var sub = thisSub;
                var params = [];
                while (sub) {
                    params.push({ publication: sub.getPublication(), params: sub.getParameters() });
                    sub = sub.parentSubscription;
                }
                return params;
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
                    return thisSub; //$q.resolve(getData());
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
             * @returns a promise that waits for the initial fetch to complete then wait for the initial fetch to complete then returns this subscription.
             */
            function waitForSubscriptionReady() {
                return startSyncing().then(function () {
                    return thisSub;
                });
            }

            /**
             * @returns a promise that waits for the initial fetch to complete then returns the data
             */
            function waitForDataReady() {
                return startSyncing();
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
                deferredInitialization = $q.defer();
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
                    listenForReconnectionToResync();
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
                        id: subscriptionId
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
                                deferredInitialization.resolve(getData());
                            }
                        }
                    )
                }
                // unit test will know when the apply is completed when the promise resolve;
                return $q.resolve();
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
                    removeObjectDependentSubscriptions(obj);
                    obj.removed = true;
                    promises.push(mapDataToOject(obj));

                    //   var recordState = getRecordState(obj);
                    //     if (recordState) {
                    //         removeObjectDependentSubscriptions(obj);
                    //         recordState.removed = true;
                    //         promises.push(mapDataToOject(recordState));
                    //     }
                });
                return $q.all(promises).finally(function () {
                    recordStates = {};
                    cache.length = 0;
                });
            }

            function clearObjectCache() {
                removeObjectDependentSubscriptions(cache);
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
                var newDataArray = [];
                var promises = [];
                thisSub.ready = false;
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

                // TODO: Investigate could be a scenario where those promises never resolve or fail?????
                return $q.all(promises).then(function () {
                    thisSub.ready = true;
                    if (isSingleObjectCache) {
                        syncListener.notify('ready', getData());
                    } else {
                        syncListener.notify('ready', getData(), newDataArray);
                    }
                });
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
                logDebug('Sync -> Inserted New record #' + JSON.stringify(record.id) + (force ? ' directly' : ' via sync') + ' for subscription to ' + publication); // JSON.stringify(record));
                getRevision(record); // just make sure we can get a revision before we handle this record

                clearClientStamp(record);

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
                    return $q.resolve();
                }

                // has Sync received a record whose version was originated locally?
                var obj = isSingleObjectCache ? cache : previous;
                if (isLocalChange(obj, record)) {
                    logDebug('Sync -> Updated own record #' + JSON.stringify(record.id) + ' for subscription to ' + publication); // JSON.stringify(record));
                    obj.revision = record.revision;
                    obj.timestamp = record.timestamp;
                    obj.timestamp.clientStamp = true; // this allows new revision that don't change the timestamp (ex server update not initiated on client to be merged. otherwise client would believe it made the change)
                    syncListener.notify('update', obj);
                    return $q.resolve(obj);
                }

                clearClientStamp(record);

                logDebug('Sync -> Updated record #' + JSON.stringify(record.id) + (force ? ' directly' : ' via sync') + ' for subscription to ' + publication); // JSON.stringify(record));
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
                    logDebug('Sync -> Removed #' + JSON.stringify(record.id) + (force ? ' directly' : ' via sync') + ' for subscription to ' + publication);
                    // We could have for the same record consecutively fetching in this order:
                    // delete id:4, rev 10, then add id:4, rev 9.... by keeping track of what was deleted, we will not add the record since it was deleted with a most recent timestamp.
                    record.removed = true; // So we only flag as removed, later on the garbage collector will get rid of it.       

                    clearClientStamp(record);

                    // if there is no previous record we do not need to removed any thing from our storage.     
                    if (previous) {
                        updateDataStorage(record);
                        removeObjectDependentSubscriptions(record);
                        syncListener.notify('remove', record);
                        dispose(record);
                        return mapDataToOject(previous, true);
                    }
                }
                return $q.resolve(record);
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


            // this will evolve... as this introduce a new field in the object (timestamp.clientStamp)
            // maybe we should have 
            // an object property 
            // timestamp { revision:, clientStamp:...} or $$sync
            function isLocalChange(previous, update) {
                return (update.timestamp
                    && previous.timestamp
                    && update.timestamp.clientStamp
                    && update.timestamp.clientStamp === previous.timestamp.clientStamp
                    && getRevision(update) === getRevision(previous) + 1
                );
            }

            // clear timestamp, since this record was not originated locally
            function clearClientStamp(record) {
                if (record.timestamp) {
                    record.timestamp.clientStamp = null;
                }
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
                    $syncMerge.update(cache, record, strictMode, deepMerge);
                } else {
                    $syncMerge.clearObject(cache);
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
                } else {
                    $syncMerge.update(existing, record, strictMode, deepMerge);
                    if (record.removed) {
                        cache.splice(cache.indexOf(existing), 1);
                    }
                }
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
                listeners[id++] = callback;
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

    function logError(msg, e) {
        if (debug >= 0) {
            console.error('SYNC(error): ' + msg, e);
        }
    }

    function getCurrentSubscriptionCount() {
        return totalSub;
    }



};
