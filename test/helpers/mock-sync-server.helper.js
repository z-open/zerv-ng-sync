
angular
    .module('sync.test')
    .provider('mockSyncServer', mockSyncServer);

function mockSyncServer() {

    var debug;

    this.setDebug = function (value) {
        debug = value;
    };


    this.$get = function sync($q, $socketio, $sync, publicationService) {

        var publicationsWithSubscriptions = publicationService;

        var subCount = 0;



        var service = {
            onPublicationNotficationCallback: onPublicationNotficationCallback,
            setData: setData,
            publishArray: publishArray,
            publishObject: publishObject,
            notifyDataChanges: notifyDataChanges,
            notifyDataRemovals: notifyDataRemovals,
            subscribe: subscribe,
            unsubscribe: unsubscribe,
            acknowledge: acknowledge,
        }

        $socketio.onFetch('sync.subscribe', function () {
            return service.subscribe.apply(self, arguments);
        });

        $socketio.onFetch('sync.unsubscribe', function () {
            return service.unsubscribe.apply(self, arguments);
        });

        return service;

        function onPublicationNotficationCallback(data) {
            return $socketio.send('SYNC_NOW', data, service.acknowledge);
        }

        function publishArray(subParams, data) {
            if (!_.isArray(data)) {
                throw new Error('Parameter data must be an array');
            }
            setData(subParams, data);
        }
        function publishObject(subParams, obj) {
            if (!_.isObject(obj) || _.isArray(obj)) {
                throw new Error('Parameter obj must be an object including publication and params fields');
            }
            setData(subParams, [obj]);
        }

        /**
         * @param data
         * @param <object> subParams
         *   which contains publication and params
         *   if not provided, a default publication will be created
         */
        function setData(subParams, data) {
            data.forEach(function (record) {
                if (_.isNil(record.revision)) {
                    throw new Error('Objects in publication must have a revision and id. Check you unit test data for ' + JSON.stringify(subParams));
                }
            });
            return publicationsWithSubscriptions.setData(data, subParams.publication, subParams.params);
        }

        function notifyDataChanges(subParams, data) {
            var publication = publicationsWithSubscriptions.findPublication(subParams.publication, subParams.params);

            if (!publication) {
                throw ('Attempt to update data from a publication that does NOT exist. You must set the publication data during the unit test setup phase (use setData functions).');
            }
            data = publication.update(data);
            return notifySubscriptions(publication, data);
        }

        function notifyDataRemovals(subParams, data) {
            var publication = publicationsWithSubscriptions.findPublication(subParams.publication, subParams.params);

            if (!publication) {
                throw ('Attempt to remove data from a publication that does NOT exist. You must set the publication data during the unit test setup phase (use setData functions).');
            }

            data = publication.remove(data);
            _.forEach(data, function (record) { record.remove = true; });
            return notifySubscriptions(publication, data);
        }

        function notifySubscriptions(publication, data) {
            return $q.all(_.map(publication.subscriptionIds, function (id) {
                return onPublicationNotficationCallback({
                    name: publication.name,
                    subscriptionId: id,
                    params: publication.params,
                    records: data,
                    diff: true
                }, service.acknowledge);
            }));
        }

        function subscribe(subParams) {
            subParams = _.omit(subParams, ['version']);
            logDebug('Subscribe ', subParams);
            var publication;
            var subId;

            if (subParams.id) {
                publication = publicationsWithSubscriptions.findPublicationBySubscriptionId(subParams.id);
                subId = subParams.id;
                if (!publication) {
                    throw new Error('Subscription with id [' + subParams.id + '] does not exist.');
                }
            } else {
                publication = publicationsWithSubscriptions.findPublication(subParams.publication, subParams.params);
                if (!publication) {
                    throw new Error('Publication [' + JSON.stringify(subParams) + '] was NOT initialized before use. You must create this publication in your unit test setup phase (use a publish function). Then only the subscription will be able to receive its data.');
                }
                subId = 'sub#' + (++subCount);
                publication.subscriptionIds.push(subId);
            }



            return $q.resolve(subId).then(function (subId) {
                publication.subId = subId;
                onPublicationNotficationCallback({
                    name: publication.name,
                    subscriptionId: subId,  // this is the id for the new subscription.
                    params: publication.params,
                    records: publication.getData(),
                }, service.acknowledge);
                return subId;
            })
        }

        function unsubscribe(data) {
            logDebug("Unsubscribed: ", data);
            return $q.resolve();
        }

        function acknowledge(ack) {
            logDebug('Client acknowledge receiving data');
        }

        function logDebug(msg) {
            if (debug) {
                console.debug('MOCKSERV: ' + msg);
            }
        }
    }
}






