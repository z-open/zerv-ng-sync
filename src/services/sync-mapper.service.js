angular
    .module('zerv.sync')
    .provider('$syncMapping', syncMappingProvider);

/**
 * This service helper maps an object properties to subscriptions.
 * 
 *  When a configuration is provided within a subscription to map a SYNC object or array (see mapArrayDs or mapObjectDs subscription functions)
 *  property mappers will be created for each property that needs to get their data from a subscription.
 * 
 *  When the data from the dependent subscription is received, the property mapper will call the provided map function (mapFn).
 *  The provided function will set the object properly.
 * 
 *  Ex: biz object has a managerId with a mapping function(person,biz) {
 *        biz.manager = person;
 *      }
 *      a object mapping configuration is provided to suscribe to the person publication.
 * 
 *  When the person publication returns the data, the mapping function executes.
 * 
 *  Note:
 *  for each biz record, property mappers are created. Subscriptions are reused when multiple mappers uses the same subscription.
 * 
 *  
 */
function syncMappingProvider() {
    var debug;

    this.setDebug = function(value) {
        debug = value;
    };

    this.$get = function syncMapping($pq) {
        var service = {
            addSyncObjectDefinition: addSyncObjectDefinition,
            addSyncArrayDefinition: addSyncArrayDefinition,
            mapObjectPropertiesToSubscriptionData: mapObjectPropertiesToSubscriptionData,
            removePropertyMappers: removePropertyMappers,
            destroyDependentSubscriptions: destroyDependentSubscriptions,
        };

        return service;

        // ////////

        function upgrade(thiSub) {
            if (thiSub.$datasources) {
                return;
            }
            // the following properties are only needed for subscription with property mappers
            thiSub.$getPool = $getPool;
            thiSub.$datasources = [];
            thiSub.$pool = [];
        }

        /**
         *  when a subscription is created, it can be reused by other mappers to avoid duplicating subscription to same publication and params
         * 
         */
        function $getPool() {
            var subscription = this;
            if (!subscription.$parentSubscription) {
                return subscription.$pool;
            }
            return subscription.$parentSubscription.$getPool();
        }

        /**
         * 
         *  set up the definition of a property mapper that maps an array.
         * 
         */
        function addSyncObjectDefinition(subscription, publication, paramsFn, mapFn, options) {
            upgrade(subscription);
            options = _.assign({}, options);
            subscription.$dependentSubscriptionDefinitions.push({
                publication: publication,
                paramsFn: getParamsFn(paramsFn),
                mapFn: mapFn,
                single: true,
                objectClass: options.objectClass,
                mappings: options.mappings,
                notifyReady: options.notifyReady,
            });
        }

        /**
         * 
         *  set up the definition of a property mapper that maps an Object.
         * 
         */
        function addSyncArrayDefinition(subscription, publication, paramsFn, mapFn, options) {
            upgrade(subscription);
            options = _.assign({}, options);
            subscription.$dependentSubscriptionDefinitions.push({
                publication: publication,
                paramsFn: getParamsFn(paramsFn),
                mapFn: mapFn,
                single: false,
                objectClass: options.objectClass,
                mappings: options.mappings,
                notifyReady: options.notifyReady,

            });
            return subscription;
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
                fn = function(obj) {
                    var mappingParams = {};
                    for (var key in fnOrMap) {
                        if (fnOrMap.hasOwnProperty(key)) {
                            var v = _.get(obj, fnOrMap[key]);
                            if (!_.isNil(v)) {
                                mappingParams[key] = v;
                            }
                        }
                    }
                    return mappingParams;
                };
            }

            return function() {
                var mappingParams = fn.apply(this, arguments);
                // if there is no param, there is no mapping to do, most likely, there is no need for the dependent subscription
                // ex a person.driverLicenceId.... if that person does not have this information, there would be no need to try to subscribe
                if (!mappingParams || !Object.keys(mappingParams).length) {
                    return null;
                }
                return mappingParams;
            };
        }


        /**
         * wait for the subscriptions to pull their data then update the object
         * 
         * @returns <Promise> Resolve when it completes
         */
        function mapObjectPropertiesToSubscriptionData(subscription, obj) {
            if (subscription.$dependentSubscriptionDefinitions.length === 0) {
                return $pq.resolve(obj);
            }

            // Each property of an object that requires mapping must be set to get data from the proper subscription
            var propertyMappers = findPropertyMappers(subscription, obj);
            if (!propertyMappers) {
                propertyMappers = createPropertyMappers(subscription, obj);
            }
            return $pq.all(_.map(propertyMappers,
                function(propertyMapper) {
                    return propertyMapper.update(obj);
                }))
                .then(function() {
                    // object is now mapped with all data supplied by the subscriptions.
                    return obj;
                });
        }


        /**
         * Each object might be mapped to some data supplied by a subscription
         * All properties of an object that requires this mapping will have property mapper
         * 
         */
        function createPropertyMappers(subscription, obj) {
            logDebug('Sync -> creating ' + subscription.$dependentSubscriptionDefinitions.length + ' property mapper(s) for record #' + JSON.stringify(obj.id) + ' of subscription ' + subscription);

            var propertyMappers = [];
            _.forEach(subscription.$dependentSubscriptionDefinitions,
                function(dependentSubDef) {
                    propertyMappers.push(new PropertyMapper(subscription, obj, dependentSubDef));
                }
            );
            subscription.$datasources.push({
                objId: obj.id,
                propertyMappers: propertyMappers,
            });
            return propertyMappers;
        }

        /**
              * find all subscriptions linked to the current object
              * 
              *  @param <Object> the object of the cache that will be mapped with additional data from subscription when they arrived
              *  @returns all the subscriptions linked to this object
              */
        function findPropertyMappers(subscription, obj) {
            var objDs = _.find(subscription.$datasources, {objId: obj.id});
            return objDs ? objDs.propertyMappers : null;
        }

        /**
         * remove the subscriptions that an object depends on if any
         * 
         *  @param <Object> the object of that was removed
         */
        function removePropertyMappers(subscription, obj) {
            var objDs = _.find(subscription.$datasources, {objId: obj.id});
            if (objDs && objDs.propertyMappers.length !== 0) {
                logDebug('Sync -> Removing property mappers for record #' + obj.id + ' of subscription to ' + subscription);
                _.forEach(objDs.propertyMappers, function(sub) {
                    sub.destroy();
                });
            }
        }

        /**
         * Destroy all subscriptions created by a subscription that has property mappers
         */
        function destroyDependentSubscriptions(subscription) {
            var allSubscriptions = _.flatten(_.map(subscription.$datasources, function(datasource) {
                return _.map(datasource.propertyMappers, function(propertyMapper) {
                    return propertyMapper.subscription;
                });
            }));
            var deps = [];
            _.forEach(allSubscriptions, function(sub) {
                if (!sub) {
                    return;
                }
                deps.push(sub.getPublication());
                sub.destroy();
            });
        }


        /**
         * A property mapper is in charge of mapping an object in a parent object based on some id property value in the parent object.
         * 
         * ex:
         *   biz.managagerId
         * 
         * the property mapper will help set biz.manager by establishing a subscription to obtain the object.
         * 
         */
        function PropertyMapper(subscription, obj, dependentSubDef) {
            this.subscription = null;
            this.objectId = obj.id;
            this.parentSubscription = subscription;
            this.definition = dependentSubDef;
            this.hasDataToMap = hasDataToMap;
            this.setParams = setParams;

            this.update = update;

            this.mapFn = mapFn;
            this.clear = clear;
            this.destroy = destroy;

            function hasDataToMap() {
                return !_.isNil(this.subscription);
            }

            function update(obj) {
                var propertyMapper = this;
                // does the object have a value for this propertyMapper?
                var subParams = propertyMapper.definition.paramsFn(obj, collectParentSubscriptionParams(subscription));
                // no value, then propertyMapper do not map data from any subscription
                if (_.isEmpty(subParams)) {
                    propertyMapper.clear();
                    return false;
                } else {
                    propertyMapper.setParams(obj, subParams);

                    return propertyMapper.subscription.waitForDataReady().then(function(data) {
                        if (propertyMapper.subscription.isSingle()) {
                            propertyMapper.definition.mapFn(data, obj, false, '');
                        } else {
                            _.forEach(data, function(resultObj) {
                                propertyMapper.definition.mapFn(resultObj, obj, false, '');
                            });
                        }
                    });
                }
            }

            /**
             *  Set the params for this property mapper, so that it can pull the correct data before doing the mapping.
             */
            function setParams(obj, params) {
                // if nothing change, the propertyMapper is already connected to the right subscription
                if (_.isEqual(params, this.params)) {
                    return;
                }
                this.params = params;
                var depSub = findSubScriptionInPool(subscription, this.definition, params);
                if (depSub) {
                    // let's reuse an existing sub
                    depSub.propertyMappers.push(this);
                    this.subscription = depSub;
                } else {
                    depSub = createObjectDependentSubscription(subscription, this.definition, this.params);
                    depSub.propertyMappers = [this];
                    this.subscription = depSub;
                    subscription.$getPool().push(depSub);
                }
                this.subscription = depSub;
            }

            /**
             * Function that will run the mapFn provided in the definiton providing the propert instance of the objects to update.
             */
            function mapFn(dependentSubObject, operation) {
                var objectToBeMapped = subscription.getData(obj.id);
                if (objectToBeMapped) {
                    logDebug('Sync -> mapping data [' + operation + '] of dependent sub [' + dependentSubDef.publication + '] to record of sub [' + subscription + ']');
                    // need to remove 3rd params...!!!
                    this.definition.mapFn(dependentSubObject, objectToBeMapped, dependentSubObject.removed, operation);
                }
            }
            function clear() {
                this.params = null;
                this.destroy();
            }


            /**
             * Destroy a property mapper
             * 
             * this might happen when the parent object is removed from a subscription (sync removal),
             * then the property mappers are no longer useful.
             * 
             * 
             */
            function destroy() {
                // is this propertyMapper connected to a subscription
                if (!this.subscription) {
                    return;
                }
                _.pull(this.subscription.propertyMappers, this);
                // if there is no propertyMapper on this subscription, it is no longer needed.
                if (this.subscription.propertyMappers.length === 0) {
                    this.subscription.destroy();
                    // _.pull(pool, this.subscription);
                    _.pull(subscription.$getPool(), this.subscription);
                }
            }
        }

        /**
         * This gives access to the params of the parent subscriptions.
         * 
         * Mapping can be deep.
         * 
         * Ex subscription to bix, which has a subscription to location, which has one to person.
         * 
         * 
         */
        function collectParentSubscriptionParams(subscription) {
            var sub = subscription;
            var params = [];
            while (sub) {
                params.push({publication: sub.getPublication(), params: sub.getParameters()});
                sub = sub.$parentSubscription;
            }
            return params;
        }

        /**
         * When a subscription is active, it is stored in a pool to be reuse by another property mapper to avoid recreating identical subscription.
         * 
         */
        function findSubScriptionInPool(subscription, definition, params) {
            var depSub = _.find(subscription.$getPool(), function(subscription) {
                // subscription should have a propertyMapper for the definition
                return _.isEqual(subscription.getParameters(), params);
            });
            return depSub;
        }

        /**
           * create the dependent subscription for each object of the cache
           * 
           *  @param <Object> the object of the cache that will be mapped with additional data from subscription when they arrived
           *  @returns all the subscriptions linked to this object
           */
        function createObjectDependentSubscription(subscription, definition, subParams) {
            var depSub = subscription
                .$createDependentSubscription(definition.publication)
                .setObjectClass(definition.objectClass)
                .setSingle(definition.single)
                .mapData(function(dependentSubObject, operation) {
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
                    _.forEach(depSub.propertyMappers, function(propertyMapper) {
                        propertyMapper.mapFn(dependentSubObject, operation);
                    });
                })
                .setOnReady(function() {
                    // if the main sync is NOT ready, it means it is in the process of being ready and will notify when it is
                    if (definition.notifyReady && subscription.isReady()) {
                        notifyMainSubscription(subscription, depSub);
                    }
                });


            // the dependent subscription might have itself some mappings
            if (definition.mappings) {
                depSub.map(definition.mappings);
            }
            // this starts the subscription using the params computed by the function provided when the dependent subscription was defined
            depSub.setParameters(subParams);
            return depSub;
        }

        /**
         * When a dependent subscription is updated (ex new record), we might need to notify the setOnReady of the main subscription.
         * 
         * See option notify when declaring a mapping.
         */
        function notifyMainSubscription(subscription, dependentSubscription) {
            var mainObjectId = collectMainObjectId(dependentSubscription);
            var mainSub = subscription;
            while (mainSub.$parentSubscription) {
                mainSub = mainSub.$parentSubscription;
            }
            logDebug('Sync -> Notifying main subscription ' + mainSub.getPublication() + ' that its dependent subscription ' + dependentSubscription.getPublication() + ' was updated.');
            mainSub.$notifyUpdateWithinDependentSubscription(mainObjectId);
        }

        function collectMainObjectId(dependentSubscription) {
            var id;
            while (dependentSubscription && dependentSubscription.objectId) {
                id = dependentSubscription.objectId;
                dependentSubscription = dependentSubscription.$parentSubscription;
            }
            return id;
        }
    };

    function logDebug(msg) {
        if (debug >= 2) {
            console.debug('SYNCMAP(debug): ' + msg);
        }
    }
}


