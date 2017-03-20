angular
    .module('sync')
    .factory('$syncMapping', syncGarbageCollector);


function syncGarbageCollector() {

    var debug = 2;
    var service = {
        createPropertyMappers: createPropertyMappers,
        findPropertyMappers: findPropertyMappers,
        removePropertyMappers: removePropertyMappers,
        destroyDependentSubscriptions: destroyDependentSubscriptions
    };

    return service;

    //////////


    /**
     * Each object might be mapped to some data supplied by a subscription
     * All properties of an object that requires this mapping will have property mapper
     * 
     */
    function createPropertyMappers(thisSub, obj) {
        logDebug('Sync -> creating ' + thisSub.$dependentSubscriptionDefinitions.length + ' property mapper(s) for record #' + JSON.stringify(obj.id) + ' of subscription ' + thisSub);

        var propertyMappers = [];
        _.forEach(thisSub.$dependentSubscriptionDefinitions,
            function (dependentSubDef) {
                propertyMappers.push(new PropertyMapper(thisSub, obj, dependentSubDef));
            }
        );
        thisSub.$datasources.push({
            objId: obj.id,
            propertyMappers: propertyMappers
        });
        return propertyMappers;
    }

    /**
          * find all subscriptions linked to the current object
          * 
          *  @param <Object> the object of the cache that will be mapped with additional data from subscription when they arrived
          *  @returns all the subscriptions linked to this object
          */
    function findPropertyMappers(thisSub, obj) {
        var objDs = _.find(thisSub.$datasources, { objId: obj.id });
        return objDs ? objDs.propertyMappers : null;
    }

    /**
     * remove the subscriptions that an object depends on if any
     * 
     *  @param <Object> the object of that was removed
     */
    function removePropertyMappers(thisSub, obj) {
        var objDs = _.find(thisSub.$datasources, { objId: obj.id });
        if (objDs && objDs.propertyMappers.length !== 0) {
            logDebug('Sync -> Removing property mappers for record #' + obj.id + ' of subscription to ' + thisSub);
            _.forEach(objDs.propertyMappers, function (sub) {
                sub.destroy();
            });
        }
    }

    function destroyDependentSubscriptions(thisSub) {
        var allSubscriptions = _.flatten(_.map(thisSub.$datasources, function (datasource) {
            return _.map(datasource.propertyMappers, function (propertyMapper) {
                return propertyMapper.subscription;
            });
        }));
        var deps = [];
        _.forEach(allSubscriptions, function (sub) {
            if (!sub) {
                return;
            }
            deps.push(sub.getPublication());
            sub.destroy();
        });
    }


    /**
     * A property mapper is in charge to map an object in object
     * 
     * ex:
     *   biz.managagerId
     * 
     * the property mapper will help set biz.manager by establishing a subscription to obtain the object.
     * 
     */
    function PropertyMapper(thisSub, obj, dependentSubDef) {

        this.subscription = null;
        this.objectId = obj.id;
        this.parentSubscription = thisSub;
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
            var subParams = propertyMapper.definition.paramsFn(obj, collectParentSubscriptionParams(thisSub));
            // no value, then propertyMapper do not map data from any subscription
            if (_.isEmpty(subParams)) {
                propertyMapper.clear();
                return false;
            } else {
                propertyMapper.setParams(obj, subParams);

                return propertyMapper.subscription.waitForDataReady().then(function (data) {
                    if (propertyMapper.subscription.isSingle()) {
                        propertyMapper.definition.mapFn(data, obj, false, '');
                    } else {
                        _.forEach(data, function (resultObj) {
                            propertyMapper.definition.mapFn(resultObj, obj, false, '');
                        });
                    }
                });
            }
        }

        function setParams(obj, params) {
            // if nothing change, the propertyMapper is already connected to the right subscription
            if (_.isEqual(params, this.params)) {
                return
            }
            this.params = params;
            var depSub = findSubScriptionInPool(thisSub, this.definition, params);
            if (depSub) {
                // let's reuse an existing sub
                depSub.propertyMappers.push(this);
                this.subscription = depSub;
            } else {
                depSub = thisSub.createObjectDependentSubscription(this.definition, this.params);
                depSub.propertyMappers = [this];
                this.subscription = depSub;
                thisSub.$getPool().push(depSub);
            }
            this.subscription = depSub;
        }

        function mapFn(dependentSubObject, operation) {
            var objectToBeMapped = thisSub.getData(obj.id);
            if (objectToBeMapped) {
                logDebug('Sync -> mapping data [' + operation + '] of dependent sub [' + dependentSubDef.publication + '] to record of sub [' + thisSub + ']');
                // need to remove 3rd params...!!!
                this.definition.mapFn(dependentSubObject, objectToBeMapped, dependentSubObject.removed, operation);
            }
        }
        function clear() {
            this.params = null;
            this.destroy();
        }


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
                _.pull(thisSub.$getPool(), this.subscription);
            }
        }
    }

    function collectParentSubscriptionParams(thisSub) {
        var sub = thisSub;
        var params = [];
        while (sub) {
            params.push({ publication: sub.getPublication(), params: sub.getParameters() });
            sub = sub.$parentSubscription;
        }
        return params;
    }

    function findSubScriptionInPool(thisSub, definition, params) {
        var depSub = _.find(thisSub.$getPool(), function (subscription) {
            // subscription should have a propertyMapper for the definition
            return _.isEqual(subscription.getParameters(), params);
        })
        return depSub;
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




}


