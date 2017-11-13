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
let totalSub = 0, strictCode = false;

let benchmark = true, isLogDebug, isLogInfo, defaultReleaseDelay = 30, defaultInitializationTimeout = 10;

let latencyInMilliSecs = 0;

const deserialize = _.isNil(window.ZJSONBIN) || window.ZJSONBIN.disabled ? noop : window.ZJSONBIN.deserialize;
function noop(r) {
    return r;
}

this.setDebug = function(value) {
    isLogInfo = value === 1;
    isLogDebug = value === 2;
    $syncMappingProvider.setDebug(isLogDebug);
    return this;
};
this.setBenchmark = function(value) {
    benchmark = value;
    return this;
};

this.setStrictCode = function(value) {
    strictCode = value;
    return this;
};

/**
 *  add a delay before processing publication data to simulate network latency
 * 
 * @param <number> milliseconds
 * 
 */
this.setLatency = function(seconds) {
    latencyInMilliSecs = seconds;
    return this;
};

/**
 * Delay before a released subscription stop syncing (see attach)
 * 
 *  @param <number> seconds
 */
this.setReleaseDelay = function(seconds) {
    defaultReleaseDelay = seconds * 1000;
    return this;
};

this.setInitializationTimeout = function(seconds) {
    defaultInitializationTimeout = seconds * 1000;
    return this;
};

this.$get = function sync($rootScope, $pq, $socketio, $syncGarbageCollector, $syncMapping, sessionUser) {
    const publicationListeners = {};
    let lastPublicationListenerUid = 0;
    let GRACE_PERIOD_IN_SECONDS = 8;
    const SYNC_VERSION = '1.2';

    listenToPublicationNotification();

    const service = {
        subscribe: subscribe,
        subscribeObject: subscribeObject,
        resolveSubscription: resolveSubscription,
        getGracePeriod: getGracePeriod,
        getIdValue: getIdValue,
        getCurrentSubscriptionCount: getCurrentSubscriptionCount,
    };

    return service;

    // /////////////////////////////////
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
        const deferred = $pq.defer();
        const sDs = subscribe(publicationName).setObjectClass(objectClass);

        // give a little time for subscription to fetch the data...otherwise give up so that we don't get stuck in a resolve waiting forever.
        const gracePeriod = setTimeout(function() {
            if (!sDs.ready) {
                sDs.destroy();
                isLogInfo && logInfo('Attempt to subscribe to publication ' + publicationName + ' failed');
                deferred.reject('SYNC_TIMEOUT');
            }
        }, GRACE_PERIOD_IN_SECONDS * 1000);

        sDs.setParameters(params)
            .waitForInitialization()
            .then(function() {
                clearTimeout(gracePeriod);
                deferred.resolve(sDs);
            }).catch(function() {
                clearTimeout(gracePeriod);
                sDs.destroy();
                deferred.reject('Failed to subscribe to publication ' + publicationName + ' failed');
            });
        return deferred.promise;
    }

    function subscribeObject(schema, id) {
        const options = _.assign({}, schema.options);
        return subscribe(schema.publication)
            .setSingle(true)
            .setObjectClass(options.objectClass)
            .map(options.mappings)
            .setParameters({id: id});
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


    // /////////////////////////////////
    // HELPERS

    // every sync notification comes thru the same event then it is dispatches to the targeted subscriptions.
    function listenToPublicationNotification() {
        $socketio.on(
            'SYNC_NOW',
            function(serializedObj, fn) {
                const subNotification = deserialize(serializedObj);

                isLogInfo && logInfo('Syncing with [' + subNotification.name + ', id:' + subNotification.subscriptionId + ' , params:' + JSON.stringify(subNotification.params) + ']. Records:' + subNotification.records.length + '[' + (subNotification.diff ? 'Diff' : 'All') + ']');
                const listeners = publicationListeners[subNotification.name];
                const processed = [];
                if (listeners) {
                    for (let listener in listeners) {
                        if (listeners.hasOwnProperty(listener)) {
                            processed.push(listeners[listener](subNotification));
                        }
                    }
                }
                fn('SYNCED'); // let know the backend the client was able to sync.

                // returns a promise to know when the subscriptions have completed syncing    
                return $pq.all(processed);
            });
    };


    // this allows a dataset to listen to any SYNC_NOW event..and if the notification is about its data.
    function addPublicationListener(streamName, callback) {
        const uid = lastPublicationListenerUid++;
        let listeners = publicationListeners[streamName];
        if (!listeners) {
            publicationListeners[streamName] = listeners = {};
        }
        listeners[uid] = callback;
        totalSub++;
        //    console.log('Added new one. remaining active publication: ' + totalSub);


        return function() {
            totalSub--;
            //    console.log('Release one. remaining active publication: ' + totalSub);
            delete listeners[uid];
        };
    }


    /**
     * The filtered dataset is a subset of a subscription cache.
     * 
     * 
     * @param {*} ds 
     * @param {*} filter 
     * @param {*} scope 
     * @param {*} onDestroyFn 
     */
    function FilteredDataSet( ds, filter, scope, onDestroyFn) {
        let orderByFn, onReadyFn;
        const cache = [];
        const thisDs = this;

        this.attach = attach;
        this.waitForDataReady = waitForDataReady;
        this.waitForInitialization = waitForInitialization;
        this.getData = getData;
        this.getOne = getOne;
        this.getAll = getAll;
        this.sort = sort;
        this.orderBy = orderBy;
        this.destroy = destroy;
        this.setOnReady = setOnReady;

        // when the subscription data is updated, the subset updates its own cache.
        const offs = [
            ds.onUpdate(updateCache),
            ds.onAdd(updateCache),
            ds.onRemove(deleteCache),
            ds.onReady(function() {
                if (orderByFn) {
                    orderByFn();
                }
                if (onReadyFn) {
                    onReadyFn(getData());
                }
            }),
        ];

        if (scope) {
            attach(scope);
        }

        /**
         * The callback will be called each time the data is ready
         * 
         * @param {Function} callback 
         */
        function setOnReady(callback) {
            onReadyFn = callback;
            return thisDs;
        }

        /**
         * Attach this dataset, it will be released (no longer updating on sync) when the scope is destroyed;
         * 
         * @param {*} newScope 
         */
        function attach(newScope) {
            if (scope) {
                throw new Error('Filtered dataset is already attached to a scope');
            }
            scope = newScope;
            scope.$on('$destroy', function() {
                destroy();
            });
            return this;
        }

        /**
         * @deprecated use waitForInitialization instead
         * @param {*} callback 
         */
        function waitForDataReady(callback) {
            logWarn('waitForDataReady is deprecated, use waitForInitialization instead');
            return ds.waitForDataReady(callback);
            // .then(updateAllCache);
        }

        function waitForInitialization(callback) {
            return ds.waitForInitialization(callback);
        }

        // function updateAllCache(data) {
        //     // is cache not initialied yet?
        //     // if (!cache.length) {
        //     //     data = _.filter( cache, filter);
        //     //     cache.length = 0;
        //     //     for (var n=0; n<data.length; n++) {
        //     //     cache.push(data[n]);
        //     //     }
        //     // }
        //     return cache;
        // }

        function updateCache(rec) {
            if (filter(rec, ds.getVars())) {
                const i = _.findIndex( cache, {id: rec.id});
                if (i !==-1) {
                    cache[i]=rec;
                } else {
                    cache.push(rec);
                }
            }
        }

        function deleteCache(rec) {
            _.remove( cache, {id: rec.id});
        }

        function destroy() {
            onDestroyFn(this);
            _.forEach(offs, function(off) {
                off();
            });
        }

        function getData() {
            return cache;
        }

        /**
         * return single record maching condition when the data is ready
         * 
         * @param {*} condition (Lodash)
         * @returns {Promise} resolved with found record
         */            
        function getOne(args) {
            if (_.isNil(args)) {
                // throw new Error('GetOne requires parameters');
                return waitForInitialization().then(
                    function() {
                        return null;
                    });
            }
            args = _.concat([cache], arguments);
            return waitForInitialization().then(
                function() {
                    return _.find.apply(this, args);
                });
        }

        /**
         * return all records when the data is ready
         * 
         *  @returns {Promise} returns with all data
         */
        function getAll() {
            return waitForInitialization().then(
                function() {
                    return cache;
                });
        }

                   /**
         * Define the maintained sort and order in the synced data source
         * It is based on lodash
         * 
         * _.orderBy(..., [iteratees=[_.identity]], [orders])
         * @param {*} fields which is [iteratees=[_.identity]]
         * @param {*} orders [order]
         */
        function orderBy(fields, orders) {
            orderByFn = function() {
                const orderedCache = _.orderBy(cache, fields, orders);
                cache.length = 0;
                _.forEach(orderedCache, function(rec) {
                        cache.push(rec);
                });
            };
            return this;
        }

        /**
         * Define the maintained sort and order in the synced data source
         * It is based on js array.sort(compareFn)
         * 
         * @param {Function} comparefn
         */
        function sort(compareFn) {
            orderByFn = function() {
                cache.sort(compareFn);
                // var orderedCache = cache.sort(compareFn);
                // cache.length = 0;
                // _.forEach(orderedCache, function(rec) {
                //         cache.push(rec);
                // });
            };
            return this;
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
        let isSyncingOn = false;
        let destroyed, isSingleObjectCache, updateDataStorage, cache, orderByFn, isInitialPushCompleted, initialStartTime, deferredInitialization;
        let onReadyOff, onUpdateOff, formatRecord;
        let reconnectOff, publicationListenerOff, destroyOff;
        let ObjectClass;
        let subscriptionId;
        let mapCustomDataFn, mapPropertyFns = [];
        const filteredDataSets = [];

        const thisSub = this;
        thisSub.$dependentSubscriptionDefinitions = [];
        let subParams = {};
        let recordStates = {};
        let innerScope; // = $rootScope.$new(true);
        const syncListener = new SyncListener();


        let dependentSubscriptions = [];
        let releaseDelay = defaultReleaseDelay;
        let initializationTimeout = defaultInitializationTimeout;

        let releaseTimeout = null;

        //  ----public----
        this.toString = toString;
        this.getPublication = getPublication;
        this.getIdb = getId;
        this.ready = false;
        this.syncOn = syncOn;
        this.syncOff = syncOff;
        this.setOnReady = setOnReady;
        this.setOnUpdate = setOnUpdate;

        this.orderBy = orderBy;
        this.sort = sort;

        this.createFilteredDataSet = createFilteredDataSet;

        this.resync = resync;

        this.onReady = onReady;
        this.onUpdate = onUpdate;
        this.onAdd = onAdd;
        this.onRemove = onRemove;

        this.getData = getData;
        this.getOne = getOne;
        this.getAll = getAll;
        this.setParameters = setParameters;
        this.getParameters = getParameters;
        this.refresh = refresh;

        this.forceChanges = forceChanges;

        this.waitForDataReady = waitForDataReady;
        this.waitForSubscriptionReady = waitForSubscriptionReady;
        this.waitForInitialization = waitForInitialization;

        this.setForce = setForce;
        this.isSyncing = isSyncing;
        this.isReady = isReady;

        this.setSingle = setSingle;
        this.isSingle = isSingle;

        this.setObjectClass = setObjectClass;
        this.getObjectClass = getObjectClass;

        this.attach = attach;
        this.detach = detach;
        this.setDependentSubscriptions = setDependentSubscriptions;
        this.setReleaseDelay = setReleaseDelay;
        this.setInitializationTimeout = setInitializationTimeout;
        this.destroy = destroy;

        this.isExistingStateFor = isExistingStateFor; // for testing purposes

        this.setVar = setVar;
        this.getVar = getVar;
        this.getVars = getVars;

        this.map = map;
        this.mapData = mapData;
        this.mapProperty = mapProperty;
        this.mapObjectDs = mapObjectDs;
        this.mapArrayDs = mapArrayDs;

        this.refreshMapping = refreshMapping;

        this.$notifyUpdateWithinDependentSubscription = $notifyUpdateWithinDependentSubscription;
        this.$createDependentSubscription = $createDependentSubscription;

        setSingle(false);

        // this will make sure that the subscription is released from servers if the app closes (close browser, refresh...)
        attach(scope || $rootScope);

        // /////////////////////////////////////////
        function getId() {
            return subscriptionId;
        }

        const globalVars = [];

        function getVars() {
            const varObject = {};
            _.forEach(globalVars, function(item) {
                varObject[item.name] = item.value;
            });
            return varObject;
        }

        function getVar(name) {
            const globalVar = _.find(globalVars, {name: name});
            return globalVar ? globalVar.value : null;
        }

        function setVar(name, fetchFn) {
            globalVars.push({name: name, fetchFn: fetchFn});
            return thisSub;
        }

        /**
         * return single record maching condition when the data is ready
         * 
         * @param {*} condition (Lodash)
         * @returns {Promise} resolved with found record
         */            
        function getOne(args) {
            if (isSingle() && !_.isNil(args)) {
                throw new Error('GetOne is only applicable to an array subscription.');
            }
            if (_.isNil(args)) {
                return waitForInitialization().then(
                    function() {
                        return null;
                    });
                // throw new Error('GetOne requires parameters');
            }
            args = _.concat([getData()], arguments);
            return waitForInitialization().then(
                function() {
                    return _.find.apply(this, args);
                });
        }

        /**
         * return all records when the data is ready
         * 
         *  @returns {Promise} returns with all data
         */
        function getAll() {
            if (isSingle()) {
                throw new Error('GetOne is only applicable to an array subscription.');
            }
            return waitForInitialization().then(
                function() {
                    return getData();
                });
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
            _.forEach(filteredDataSets, function(ds) {
                ds.destroy();
            });

            if (thisSub.$parentSubscription) {
                isLogDebug && logDebug('Destroying Sub Subscription(s) to ' + thisSub);
            } else {
                isLogDebug && logDebug('Destroying Subscription to ' + thisSub);
            }
            syncOff();
            $syncMapping.destroyDependentSubscriptions(thisSub);
            isLogDebug && logDebug('Subscription to ' + thisSub + ' destroyed.');
        }

        function createFilteredDataSet( filter, scope) {
            const fds = new FilteredDataSet( thisSub, filter, scope, function() {
                _.remove( filteredDataSets, fds);
            });
            filteredDataSets.push(fds);
            return fds;
        }


        /** 
         *  this will be called when data is available 
         *  it means right after each sync!
         * 
         *  @param {Function} callback receiving an array with all records of the cache if the subscription is to an array, otherwise the single object if the subscription is to a single object.
         */
        function setOnReady(callback) {
            if (strictCode && onReadyOff) {
                throw new Error('setOnReady is already set in subscription to ' + publication+ '. It cannot be resetted to prevent bad practice leading to potential memory leak . Consider using setOnReady when subscription is instantiated. Alternative is using onReady to set the callback but do not forget to remove the listener when no longer needed (usually at scope destruction).');
            }
            onReadyOff && onReadyOff();
            // this onReady is not attached to any scope and will only be gone when the sub is destroyed
            onReadyOff = syncListener.on('ready', callback, null);
            return thisSub;
        }

        /** 
         *  this will be called when a record is updated
         *  @param {Function} callback receiving with updated record.
         *           
         */
        function setOnUpdate(callback) {
            if (strictCode && onUpdateOff) {
                throw new Error('setOnUpdate is already set in subscription to ' + publication+ '. It cannot be resetted to prevent bad practice leading to potential memory leak . Consider using setOnUpdate when subscription is instantiated. Alternative is using onUpdate to set the callback but do not forget to remove the listener when no longer needed (usually at scope destruction).');
            }
            onUpdateOff && onUpdateOff();
            // this onUpdateOff is not attached to any scope and will only be gone when the sub is destroyed
            onUpdateOff = syncListener.on('update', callback, null);
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
            syncOff();
            return startSyncing();
        }
        /**
         * The following object will be built upon each record received from the backend
         * 
         * This cannot be modified after the sync has started.
         * 
         * @param classValue
         */
        function setObjectClass(classValue) {
            if (deferredInitialization) {
                return thisSub;
            }

            if (!classValue) {
                throw new Error('Object class cannot be null for subscription to ' + publication);
            }

            ObjectClass = classValue;
            formatRecord = function(record) {
                return new ObjectClass(record);
            };
            setSingle(isSingleObjectCache);
            return thisSub;
        }

        function getObjectClass() {
            return ObjectClass;
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
         * This provides a function that will map some data/lookup to the provided object.
         * This mapping is executed after all other potential mappings (mapDsObject, mapDsArray) have completed. 
         * 
         * 
         * ex mapData(function (obj, operation, lookupVars) {
         *      obj.city = getSomeCacheLookup(obj.cityId);
         *      obj.state = _.find(lookupVars.states, {code:obj.stateCode});
         * })
         * 
         * 
         * but avoid or use the following simple manner carefully:
         * ex mapData(function(house, operation, lookupVars) {
         *      if (operation === 'add') {   houseInWorld.push(house)}
         *      if (operation === 'remove') {   houseInWorld.remove(house)}
         * })
         * This will could create unpredicable behavior when the setParams is changed.
         * 
         * @param {Function} mapFn;
         *    function mapFn(record, operation, lookupVars) 
         *    - record: The object whose properties need mapping
         *    - operation: 'add', 'update' and 'remove' indicate what type of mapping is being applied
         *    - lookupsVars: object which contains properties initialized with setVar
         * 
         * @returns {Subscription} 
         * 
         */
        function mapData(mapFn) {
            if (strictCode && mapCustomDataFn) {
                 throw new Error('mapData has already been provided and can only be defined once.');
            }
            mapCustomDataFn = mapFn;
            return thisSub;
        }

        /**
         * provide the property that will be mapped to the object fetched.
         * 
         * sub.mapObject('city',fetchCity,'cityId')
         * when subscription receives data (obj), it will run fetchCity(obj.cityId) which would save the object in obj.city when it resolves
         * @param {String} propertyName is the property that will received the fetched value
         *              propertyName can also be 'arrayPropertyNmae.propertyName'. propertyName of objects of arrayPropertyName would be mapped. 
         * @param {Function} fetchFn might return a promise resolving with a value or the value directly, 
         *                      if fetchFn is a datasource, it will be set with the idProperty during mapping (only works if this subscription is single)
         * @param {String} idProperty is the property that hold the id used to run fetchFn
         */
        function mapProperty(propertyName, fetchFn, idProperty) {
            if (_.isNil(propertyName) || _.isNil(idProperty)) {
                throw new Error('Invalid mapping to property ' + propertyName + ' in subscription to ' + publication);
            }
            if (_.isNil(fetchFn)) {
                throw new Error('Invalid fetch function in mapping to property ' + propertyName + ' in subscription to ' + publication);
            }
            if (fetchFn instanceof Subscription) {
                mapExternalSubscriptionToProperty(propertyName, fetchFn, idProperty);
            } else {
                mapPromisedDataToProperty(propertyName, fetchFn, idProperty);
            }
            return thisSub;
        }

        function mapExternalSubscriptionToProperty(propertyName, fetchFn, idProperty) {
            dependentSubscriptions.push(fetchFn);
            mapPropertyFns.push(function(obj) {
                if (typeof obj[idProperty] === 'undefined') {
                    throw new Error('Undefined property ' + idProperty + ' of data received from subscription to ' + publication);
                }
                const fetchParams = {};
                fetchParams.id = obj[idProperty];
                return fetchFn
                    .setParameters(fetchParams)
                    .waitForInitialization()
                    .then(function(object) {
                        obj[propertyName] = object;
                    });
            });
        }

        function mapPromisedDataToProperty(propertyName, fetchFn, idProperty) {
            mapPropertyFns.push(function(obj) {
                const dot = propertyName.indexOf('.');
                if (dot !== -1) {
                    var arrayName = propertyName.substring( 0, dot);

                    if (!_.isObject(obj[arrayName])) {
                        throw new Error(arrayName+' is not an array or object in data received from subscription to ' + publication);
                    }
                    const itemPropertyName = propertyName.substring( dot+1);

                    if (!_.isArray(obj[arrayName])) {
                        obj = obj[arrayName];
                        if (typeof obj[idProperty] === 'undefined') {
                            throw new Error('Undefined property ' + idProperty + ' in ' + arrayName + ' of data received from subscription to ' + publication);
                        }
                        return fetchAndSet(obj, idProperty, itemPropertyName);
                    }


                    return $pq.all(_.map(obj[arrayName], function(item) {
                        if (typeof item[idProperty] === 'undefined') {
                            throw new Error('Undefined property ' + idProperty + ' in array '+propertyName+' of data received from subscription to ' + publication);
                        }
                        return fetchAndSet(item, idProperty, itemPropertyName);
                    }));
                }

                if (typeof obj[idProperty] === 'undefined') {
                    throw new Error('Undefined property ' + idProperty + ' in data received from subscription to ' + publication);
                }
                return fetchAndSet(obj, idProperty, propertyName);
            });

            function fetchAndSet(obj, idProperty, propertyName) {
                const result = fetchFn(obj[idProperty]);
                if (result && result.then) {
                    return result.then(function(value) {
                        obj[propertyName] = value;
                    }, function(err) {
                        throw new Error('Fetching error for property mapping ' + idProperty + ' in data received from subscription to ' + publication+'. err: '+err);
                    });
                }
                return result;
            }
        }

        // function mapPropertyDs(propertyName, externalDs, idProperty) {
        //     dependentSubscriptions.push(externalDs);
        //     var onReadyOff = externalDs.onReady(function() {
        //         dependentSub.invalid = true; // means the external sub data has changed, making this subscription obj potentially mapped to wrong data
        //     });
        // }


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
                const type = def.type ? def.type.toLowerCase() : null;
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
         * This refreshes the mapping of an object
         * @param {Object} obj 
         */
        function refreshMapping(obj) {
            if (obj.removed) {
                return obj;
            }
            return mapAllDataToObject(obj);
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
            return $pq.all(_.map(globalVars, function(varObj) {
                return varObj.fetchFn().then(function(data) {
                    varObj.value = data;
                });
            }))
            .then(function() {
            return $syncMapping.mapObjectPropertiesToSubscriptionData(thisSub, obj)
                .then(function(obj) { // , operation) {
                    return mapFullObject(obj, operation);
                })
                .catch(function(err) {
                    logError('Error when mapping received object.', err);
                    $pq.reject(err);
                });
            });
        }

        /** 
         * map all data to the object by calling their map function (mapData)
         * 
         * This is also used to map this object to the parent subscription object
         * 
         * if the mapping fails, the new object version will not be merged
         * 
         * @param obj
         * @param <String> operation (add or update or remove)
         * @returns <Promise> the promise resolves when the mapping as completed

         * 
         */
        function mapFullObject(obj, operation) {
            return mapAllRecordProperties(obj, operation)
                .then(function() {
                    if (mapCustomDataFn) {
                        const result = mapCustomDataFn(obj, operation, getVars());
                        if (result && result.then) {
                            return result
                                .then(function() {
                                    return obj;
                                });
                        }
                        return obj;
                    }
                });
        }

        /**
         * Each object property will collect and receive the proper value as defined in the property mapping configuration (mapProperty)
         * 
         * This will append for different operations such add, updated, and remove.
         * 
         * Note:
         * We might reconsider and NOT apply the mapping on remove or clear operations later on to simplify. 
         * 
         * 
         * @param {*} obj 
         * @param {*} operation 
         */
        function mapAllRecordProperties(obj, operation) {
            return $pq
            .all(_.map(mapPropertyFns, function(mapPropertyFn) {
                // property mapping does not need to clear the property mapping when cache is cleaned.
                // -> means mapData will no be called in case on cache cleaning.
                // this is not a problem except if the developer uses mapData function for other thing that mapping data. 
                // ex pushing the data to be mapped in an external object or array.
                // ex mapData(function(house,operation) {
                //       if (operation === 'remove') {   removeFromWorldHouseCount(house)}
                // })
                if (operation==='clear') {
                    return;
                }
                try {
                    const result = mapPropertyFn(obj, operation);
                    if (result && result.then) {
                        return result
                            .then(function() {
                                return obj;
                            });
                    }
                } catch (e) {
                    logError('property mapping error while syncing on ' + thisSub, e);
                    return $pq.reject(e);
                }
            }));
        }

        function $createDependentSubscription(publication) {
            const depSub = subscribe(publication);
            depSub.$parentSubscription = thisSub;
            return depSub;
        }


        function $notifyUpdateWithinDependentSubscription(idOfObjectImpactedByChange) {
            const cachedObject = getRecordState({id: idOfObjectImpactedByChange});
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
                return thisSub; // $pq.resolve(getData());
            }
            syncOff();
            cleanCache();

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
         * @deprecated use waitForInitialization instead
         * 
         * Wait for the subscription to establish initial retrieval of data and returns this subscription in a promise
         * 
         * @param {function} optional function that will be called with this subscription object when the data is ready 
         * @returns {Promise} that waits for the initial fetch to complete then wait for the initial fetch to complete then returns this subscription.
         */
        function waitForSubscriptionReady(callback) {
            logWarn('waitForSubscriptionReady is deprecated, use waitForInitialization instead');
            return startSyncing().then(function() {
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
        function waitForInitialization(callback) {
            return startSyncing().then(function(data) {
                if (callback) {
                    callback(data, thisSub);
                }
                return data;
            });
        }


        /**
         * @deprecated use waitForInitialization instead
         * 
         * @param {function} optional function that will be called with the synced data and this subscription object when the data is ready 
         * @returns {Promise} that waits for the initial fetch to complete then returns the data
         */
        function waitForDataReady(callback) {
            logWarn('waitForDataReady is deprecated, use waitForInitialization instead');
            return waitForInitialization(callback);
        }


        // does the dataset returns only one object? not an array?
        function setSingle(value) {
            if (deferredInitialization) {
                return thisSub;
            }

            let updateFn;
            isSingleObjectCache = value;
            if (value) {
                updateFn = updateSyncedObject;
                cache = ObjectClass ? clearObject(new ObjectClass({})) : {};
                cache.timestamp = {
                    $empty: true,
                    $sync: thisSub,
                };
            } else {
                updateFn = updateSyncedArray;
                cache = [];
            }

            updateDataStorage = function(record) {
                try {
                    if (record.timestamp) {
                        record.timestamp.$sync = thisSub;
                    }
                    return updateFn(record);
                } catch (e) {
                    e.message = 'Received Invalid object from publication [' + publication + ']: ' + JSON.stringify(record) + '. DETAILS: ' + e.message;
                    throw e;
                }
            };

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
            return _.find(cache, {id: id});
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

                isLogInfo && logInfo('Sync ' + publication + ' off. Params:' + JSON.stringify(subParams));
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
            if (dependentSubscriptions.length && !isSingle()) {
                throw new Error('Mapping to an external datasource can only be used when subscribing to a single object.');
            }

            if (isSyncingOn) {
                // Temporary fix to for remapping
                // ------------------------------
                // if a mapping is against an existing subscription, and the existing subscription params were changed externally, no by the mapping
                // the synced object would have mapped incorrectly, this force the re-mapping.
                // when the function setParams, waitForInitialization, syncOn are called
                // better solution would be that the external subscription let know this subscription that is params has been modified, then only we would refresh
                // the mapping.
                if (dependentSubscriptions.length) {
                    deferredInitialization.promise.then(function(data) {
                        refreshMapping(getData());
                    });
                }
                return deferredInitialization.promise;
            }
            deferredInitialization = $pq.defer();
            initialStartTime = Date.now();
            isInitialPushCompleted = false;
            isLogInfo && logInfo('Sync ' + publication + ' on. Params:' + JSON.stringify(subParams));
            isSyncingOn = true;
            registerSubscription();
            readyForListening();
            setTimeoutOnInitialization();

            return deferredInitialization.promise;
        }

        function isSyncing() {
            return isSyncingOn;
        }

        function setTimeoutOnInitialization() {
            if (!initializationTimeout) {
                return;
            }
            const initializationPromise = deferredInitialization;
            let completed = false;
            setTimeout(function() {
                if (!completed && deferredInitialization === initializationPromise) {
                    logError('Failed to load data within ' + (initializationTimeout / 1000) + 's for ' + thisSub);
                    initializationPromise.reject('sync timeout');
                    // give up syncing.
                    thisSub.syncOff();
                }
            }, initializationTimeout);
            initializationPromise.promise.then(function() {
                completed = true;
            });
        }

        function readyForListening() {
            if (!publicationListenerOff) {
                // if the subscription belongs to a parent one and the network is lost, the top parent subscription will release/destroy all dependent subscriptions and take care of re-registering itself and its dependents.
                if (!thisSub.$parentSubscription) {
                    listenForReconnectionToResync();
                }

                publicationListenerOff = addPublicationListener(
                    publication,
                    function(batch) {
                        // Create a delay before processing publication data to simulate network latency
                        if (latencyInMilliSecs) {
                            isLogInfo && logInfo('Sync -> Processing delayed for ' + latencyInMilliSecs + ' ms.'); // 
                            setTimeout(function() {
                                isLogInfo && logInfo('Sync -> Processing ' + publication + ' now.');
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
         * set which external subscription this subscription depends on.
         * When this subscription is released, the other subscription will be released as well.
         *  
         * When a subscription is released, it remains in sync for a little while to promote reuse.
         * 
         * @param {Array} subscriptions 
         */
        function setDependentSubscriptions(subs) {
            dependentSubscriptions = subs;
            return thisSub;
        }

        /**
         * set the number of seconds before a subscription stops syncing after it is release for destruction.
         * This promotes re-use.
         * 
         * @param {int} t in seconds
         */
        function setReleaseDelay(t) {
            releaseDelay = t * 1000;
        }

        function setInitializationTimeout(t) {
            initializationTimeout = t * 1000;
        }


        /**
         * Schedule this subscription to stop syncing after a lap of time (releaseDelay)
         * 
         */
        function scheduleRelease() {
            // detach must be called otherwise,  the subscription is planned for release.
            if (innerScope === $rootScope) {
                isLogDebug && logDebug('Release not necessary (unattached): ' + thisSub);
            } else {
                isLogDebug && logDebug('Releasing subscription in ' + (releaseDelay / 1000) + 's: ' + thisSub);
                releaseTimeout = setTimeout(function() {
                    if (releaseTimeout) {
                        isLogInfo && logInfo('Subscription released: ' + thisSub);
                        thisSub.syncOff();
                        releaseTimeout = null;
                    }
                }, Math.max(releaseDelay, initializationTimeout) + 500); // to make sure that a release does not happen during initialization
            }
        }

        /**
         * Detach a subscription will give the ability to reuse an active subscription without stopping syncing.
         * It is useful mainly if the subscription is used on a new scope with similar params (there is no need to resync/refetch data.)
         * 
         */
        function detach() {
            isLogDebug && logDebug('Detach subscription(release): ' + thisSub);
            // if sub was about to be released, keep it.
            if (releaseTimeout) {
                isLogInfo && logInfo('Re-use before release: ' + thisSub);
                clearTimeout(releaseTimeout);
                releaseTimeout = null;
            }
            if (destroyOff) {
                destroyOff();
            }
            innerScope = $rootScope;
            _.forEach(dependentSubscriptions, function(dsub) {
                dsub.detach();
            });
        }

        /**
         *  By default the rootscope is attached if no scope was provided. But it is possible to re-attach it to a different scope. if the subscription depends on a controller.
         * When the scope is destroyed, the subscription will be destroyed or released for future reuse if option is selected (delayRelease)
         *  a subscription that is attached to a scope cannot be reattached to another scope.
         *  It must detach first.
         * 
         *  To allow a subscription to remain in memory for re-reuse:
         * 
         *  create a subscription in a service
         *  create a view
         *  detach and start the subscription in the resolve
         *  attach it to the view controller scope with delayRelease
         *  
         *  create a different view that is not an inner view or parent view of the previous one
         *  detach and start the subscription in the resolve
         *  attach it to the view controller scope with delayRelease
         *  
         *  when the app goes to the different view, the subscription will be reused (will not re initialize if the params have not changed).
         * 
         *  
         */
        function attach(newScope, delayRelease) {
            detach();

            if (newScope === innerScope) {
                return thisSub;
            }
            // if (innerScope && innerScope !== $rootScope) {
            //     // this will never happen due to detach above.
            //     throw new Error('Subscription is already attached to a different scope. Detach first: ' + thisSub);
            // }
            isLogDebug && logDebug('Attach subscription: ' + thisSub);

            if (destroyOff) {
                destroyOff();
            }
            innerScope = newScope;
            const destroyScope = innerScope; // memorize scope as it is used during destroy

            destroyOff = innerScope.$on('$destroy', function() {
                syncListener.dropListeners(destroyScope);
                if (delayRelease) {
                    scheduleRelease();
                } else {
                    destroy();
                }
            });

            _.forEach(dependentSubscriptions, function(dsub) {
                dsub.attach(newScope, delayRelease);
            });
            return thisSub;
        }

        function listenForReconnectionToResync(listenNow) {
            // give a chance to connect before listening to reconnection... @TODO should have user_reconnected_event
            setTimeout(function() {
                reconnectOff = innerScope.$on('user_connected', function() {
                    isLogDebug && logDebug('Resyncing after network loss to ' + publication);
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
                params: subParams,
            }).then(function(subId) {
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
                    params: subParams,
                });
                subscriptionId = null;
            }
        }

        /**
         * each subscription listens to any data coming from the sync socket channel
         * If any is related to it, it will process to update the internal cache
         * 
         * Note: Potential issue
         * If consecutive syncs for a same record come for the sub, we should queue them as potential issue might rise such as
         * - the old revision updates the cache because the mapping was not completed before the new rev was updated in cache.
         *
         */
        function processPublicationData(batch) {
            // cannot only listen to subscriptionId yet...because the registration might have answer provided its id yet...but started broadcasting changes...@TODO can be improved...
            if (subscriptionId === batch.subscriptionId || (!subscriptionId && checkDataSetParamsIfMatchingBatchParams(batch.params))) {
                const startTime = Date.now();
                const size = benchmark && isLogInfo ? JSON.stringify(batch.records).length : null;

                return cleanCache(batch.records, !batch.diff)
                    .then(function() {
                        return applyChanges(batch.records, false);
                    })
                    .then(function() {
                        if (!isInitialPushCompleted) {
                            isInitialPushCompleted = true;

                            if (benchmark && isLogInfo) {
                                const timeToReceive = Date.now() - initialStartTime;
                                const timeToProcess = Date.now() - startTime;
                                isLogInfo && logInfo('Initial sync total time for ' + publication + ': ' + (timeToReceive + timeToProcess) + 'ms - Data Received in: ' + timeToReceive + 'ms, applied in: ' + timeToProcess + 'ms - Estimated size: ' + formatSize(size) + ' - Records: ' + batch.records.length + ' - Avg size/time: ' + formatSize(size / (batch.records.length || 1)) + '/' + roundNumber(timeToProcess / (batch.records.length || 1), 2) + 'ms');
                            }
                            deferredInitialization.resolve(getData());
                        }
                    });
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
         * this releases all objects that do no longer exist within the cache 
         * 
         * this can be necessary:
         * - after a network reconnection, all data is sent to the client, but the cache might have data that are no longer present in the initial fetch
         *
         * 
         * if they have dependent subscriptions, they will be released.
         * 
         * the mapAllDataObject will be called on each object to make sure object can unmapped if necessary
         * 
         *  @param {array} excludedRecords are the records that should not be removed from the cache
         *  @param {boolean} force when set to true will force the cleaning.
         * 
         *  @returns {Promise} which resolves when done.
         *  
         */
        function cleanCache(excludedRecords, force) {
            let result;
            if ((!force || !isDataCached()) && excludedRecords) {
                return $pq.resolve();
            }
            if (!isSingleObjectCache) {
                result = cleanArrayCache(findRecordsPresentInCacheOnly(excludedRecords));
                if (!isDataCached()) {
                    cache.length = 0;
                }
            } else {
                result = cleanObjectCache();
            }
            return result.catch(function(err) {
                logError('Error clearing subscription cache - ' + err);
            });
        }

        /**
         * Determine the records that are in the cache but not in the data that needs to replace the cache content.
         * These records will need removing from the cache since they are not part of the data received, and do not need updating.
         * 
         * @param {*} receivedRecordsToBeSynced contains all records that the cache should contain after a sync
         * 
         * @returns {array} records 
         */
        function findRecordsPresentInCacheOnly(receivedRecordsToBeSynced) {
            const deletedRecords = [];
            _.forEach(recordStates, function(cachedRecord, id) {
                if (!_.find(receivedRecordsToBeSynced, function(record) {
                    return id === getIdValue(record.id);
                })) {
                    deletedRecords.push( cachedRecord );
                }
            });
            return deletedRecords;
        }

        /**
         * Removed the following records from the cache, they do no longer exist.
         * 
         * @param {*} records 
         * @returns {Promise} resolve when the cache is cleaned.
         */
        function cleanArrayCache(records) {
            const promises = [];
            _.forEach(records, function(obj) {
                $syncMapping.removePropertyMappers(thisSub, obj);
                obj.removed = true;
                promises.push(mapFullObject(obj, 'clear'));
                delete recordStates[getIdValue(obj.id)];
            });
            return $pq.all(promises)
            .catch(function(err) {
                logError('Error clearing subscription cache - ' + err);
            });
        }


        function cleanObjectCache() {
            $syncMapping.removePropertyMappers(thisSub, cache);
            cache.removed = true;
            recordStates = {};
            if (cache.timestamp && cache.timestamp.$empty) {
                return $pq.resolve(cache);
            }
            return mapFullObject(cache, 'clear');
        }
        /**
         * if the params of the dataset matches the notification, it means the data needs to be collect to update array.
         */
        function checkDataSetParamsIfMatchingBatchParams(batchParams) {
            // if (params.length != streamParams.length) {
            //     return false;
            // }
            if (!subParams || Object.keys(subParams).length == 0) {
                return true;
            }
            let matching = true;
            for (let param in batchParams) {
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
         * Define the maintained sort and order in the synced data source
         * It is based on lodash
         * 
         * This has only effect on subscription on an array datasource
         * 
         * _.orderBy(..., [iteratees=[_.identity]], [orders])
         * @param {*} fields which is [iteratees=[_.identity]]
         * @param {*} orders [order]
         */
        function orderBy(fields, orders) {
            orderByFn = function() {
                if (!isSingle()) {
                    const orderedCache = _.orderBy(cache, fields, orders);
                    cache.length = 0;
                    _.forEach(orderedCache, function(rec) {
                        cache.push(rec);
                    });
                }
            };
            return thisSub;
        }

        /**
         * Define the maintained sort and order in the synced data source
         * It is based on js array.sort(compareFn)
         * 
         * This has only effect on subscription on a array datasource
         * 
         * @param {Function} comparefn
         */
        function sort(compareFn) {
            orderByFn = function() {
                if (!isSingle()) {
                    cache.sort(compareFn);
                }
            };
            return thisSub;
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
                .then(function() {
                    try {
                        const newDataArray = [];
                        const promises = [];
                        records.forEach(function(record) {
                            //                   isInfo && logInfo('Datasync [' + dataStreamName + '] received:' +JSON.stringify(record));//+ JSON.stringify(record.id));
                            if (record.remove) {
                                promises.push(removeRecord(record, force));
                            } else if (getRecordState(record)) {
                                // if the record is already present in the cache...so it is mightbe an update..
                                promises.push(updateRecord(record, force).then(function(newData) {
                                    newDataArray.push(newData);
                                }));
                            } else {
                                // if the record is already present in the cache...so it is mightbe an update..
                                promises.push(addRecord(record, force).then(function(newData) {
                                    newDataArray.push(newData);
                                }));
                            }
                        });
                        return $pq.all(promises).then(function() {
                            // if order alterered, re-order
                            if (newDataArray.length && orderByFn) {
                                orderByFn();
                            }
                            return newDataArray;
                        });
                    } catch (err) {
                        // angular does not reject automatically!! not sure why.
                        return $pq.reject(err);
                    }
                })
                // TODO: Investigate could be a scenario where those promises never resolve or fail?????
                .then(notifyDataReady);
        }

        function waitForExternalDatasourcesReady() {
            return {
                then: function(cb) {
                    return cb();
                },
            };// $pq.resolve();
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
        function onAdd(callback, scope) {
            return syncListener.on('add', callback, scope || innerScope);
        }

        /**
         * Listen to event and run callback
         * 
         * @param {function} to call on event
         * @param {Object} angular scope (by default the current attached subscription scope)
         * 
         * @returns {function} to remove the listener. Anyway, the listener will be destroyed when scope is destroyed.
         */
        function onUpdate(callback, scope) {
            return syncListener.on('update', callback, scope || innerScope);
        }

        /**
        * Listen to event and run callback
        * 
        * @param {function} to call on event
        * @param {Object} angular scope (by default the current attached subscription scope)
        * 
        * @returns {function} to remove the listener. Anyway, the listener will be destroyed when scope is destroyed.
        */
        function onRemove(callback, scope) {
            return syncListener.on('remove', callback, scope || innerScope);
        }

        /**
        * Listen to event and run callback
        * 
        * @param {function} to call on event
        * @param {Object} angular scope (by default the current attached subscription scope)
        * 
        * @returns {function} to remove the listener. Anyway, the listener will be destroyed when scope is destroyed.
        */
        function onReady(callback, scope) {
            return syncListener.on('ready', callback, scope || innerScope);
        }


        /**
         * Add record to the subscription data
         * 
         * 
         * @param {Object} record 
         * @param {boolean} force (let us know if the addition was done by sync, or forcing record manually)
         */
        function addRecord(record, force) {
            isLogDebug && logDebug('Sync -> Inserted New record #' + JSON.stringify(record.id) + (force ? ' directly' : ' via sync') + ' for subscription to ' + thisSub); // JSON.stringify(record));
            getRevision(record); // just make sure we can get a revision before we handle this record

            let obj = formatRecord ? formatRecord(record) : record;

            return mapAllDataToObject(obj, 'add').then(function() {
                obj = updateDataStorage(obj);
                syncListener.notify('add', obj);
                return obj;
            });
        }


        /**
         * Update record in the subscription data
         * 
         * 
         * @param {Object} record 
         * @param {boolean} force in the udate to replace any revision in the subscription data 
         */
        function updateRecord(record, force) {
            const previous = getRecordState(record);
            if (!force & getRevision(record) <= getRevision(previous)) {
                return $pq.resolve();
            }

            // has Sync received a record whose version was originated locally?
            let obj = isSingleObjectCache ? cache : previous;
            if (!force && isLocalChange(obj, record)) {
                isLogDebug && logDebug('Sync -> Updated own record #' + JSON.stringify(record.id) + ' for subscription to ' + thisSub);
                _.assign(obj.timestamp, record.timestamp);
                obj.revision = record.revision;
                previous.revision = record.revision;
                return $pq.resolve(obj);
            }

            isLogDebug && logDebug('Sync -> Updated record #' + JSON.stringify(record.id) + (force ? ' directly' : ' via sync') + ' for subscription to ' + thisSub);
            obj = formatRecord ? formatRecord(record) : record;

            return mapAllDataToObject(obj, 'update').then(function() {
                obj = updateDataStorage(obj);
                syncListener.notify('update', obj);
                return obj;
            });
        }

        /**
         * Add record to the subscription data
         * 
         * 
         * @param {Object} record 
         * @param {boolean} force (let us know if the removal was done by sync, or forcing record manually)
         */
        function removeRecord(record, force) {
            const previous = getRecordState(record);

            if (force || !previous || getRevision(record) > getRevision(previous)) {
                isLogDebug && logDebug('Sync -> Removed #' + JSON.stringify(record.id) + (force ? ' directly' : ' via sync') + ' for subscription to ' + thisSub);
                // We could have for the same record consecutively fetching in this order:
                // delete id:4, rev 10, then add id:4, rev 9.... by keeping track of what was deleted, we will not add the record since it was deleted with a most recent timestamp.
                record.removed = true; // So we only flag as removed, later on the garbage collector will get rid of it.       

                // if there is no previous record we do not need to removed any thing from our storage.     
                if (previous) {
                    const recordBeingDeleted = _.assign({}, previous);
                    updateDataStorage(record);
                    $syncMapping.removePropertyMappers(thisSub, record);
                    syncListener.notify('remove', record);
                    dispose(record);
                    return mapFullObject(recordBeingDeleted, 'remove');
                }
            }
            return $pq.resolve(record);
        }

        function dispose(record) {
            $syncGarbageCollector.dispose(function collect() {
                const existingRecord = getRecordState(record);
                if (existingRecord && record.revision >= existingRecord.revision) {
                    // isDebug && logDebug('Collect Now:' + JSON.stringify(record));
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
                cache.timestamp = {$empty: true};
            }
            return cache;
        }

        function updateSyncedArray(record) {
            let existing = getRecordState(record);
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
            return existing;
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
            Object.keys(object).forEach(function(key) {
                delete object[key];
            });
            return object;
        }

        function getRevision(record) {
            // what reserved field do we use as timestamp
            if (angular.isDefined(record.revision)) {
                return record.revision;
            }
            if (angular.isDefined(record.timestamp)) {
                return record.timestamp;
            }
            throw new Error('Sync requires a revision or timestamp property in received ' + (ObjectClass ? 'object [' + ObjectClass.name + ']' : 'record'));
        }
    }

    /**
     * this object 
     */
    function SyncListener() {
        const events = {};
        let count = 0;

        this.notify = notify;
        this.on = on;
        this.dropListeners = dropListeners;

        function dropListeners(scope) {
            _.forEach(events, function(listeners) {
                _.forEach(listeners, function(listener, id) {
                    if (listener.scope === scope) {
                        delete listeners[id];
                    }
                });
            });
        }

        function notify(event, data1, data2) {
            const listeners = events[event];
            if (listeners) {
                _.forEach(listeners, function(listener, id) {
                    listener.notify(data1, data2);
                });
            }
        }

        /**
         * @returns handler to unregister listener
         */
        function on(event, callback, scope) {
            let listeners = events[event];
            if (!listeners) {
                listeners = events[event] = {};
            }
            const id = count++;
            listeners[id] = {
                notify: callback,
                scope: scope,
            };
            return function() {
                delete listeners[id];
            };
        }
    }
};

function getIdValue(id) {
    if (!_.isObject(id)) {
        return id;
    }
    // build composite key value
    const r = _.join(_.map(id, function(value) {
        return value;
    }), '~');
    return r;
}

function logWarn(msg) {
    console.warn('SYNC(info): ' + msg);
}


function logInfo(msg) {
    if (isLogInfo) {
        console.debug('SYNC(info): ' + msg);
    }
}

function logDebug(msg) {
    if (isLogDebug) {
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
    const d = Math.pow(10, n);
    return Math.round(num * d) / d;
}

function logError(msg, e) {
    console.error('SYNC(error): ' + msg, e);
}

function getCurrentSubscriptionCount() {
    return totalSub;
}
};


