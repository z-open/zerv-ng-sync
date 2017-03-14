
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
        var self = service;
        // this.onPublicationNotficationCallback = onPublicationNotficationCallback;
        // this.setData = setData;
        // this.publishArray = publishArray;
        // this.publishObject = publishObject;
        // this.notifyDataChanges = notifyDataChanges;
        // this.notifyDataRemovals = notifyDataRemovals;
        // this.subscribe = subscribe;
        // this.unsubscribe = unsubscribe;
        // this.acknowledge = acknowledge;


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
            setData(subParams, data);
        }
        function publishObject(subParams, obj) {
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
                    records: data,
                    diff: true
                }, service.acknowledge);
            }));
        }

        function subscribe(subParams) {
            logDebug('Subscribe ', subParams);
            var publications;
            var subId;

            if (subParams.id) {
                publications = publicationsWithSubscriptions.findPublicationBySubscriptionId(subParams.id);
                subId = subParams.id;
                if (!publications) {
                    throw new Error('Subscription with id [' + subParams.id + '] does not exist.');
                }
            } else {
                publications = publicationsWithSubscriptions.findPublication(subParams.publication, subParams.params);
                if (!publications) {
                    throw new Error('Subscription [' + JSON.stringify(subParams) + '] was not initialized with setData. You must define the data that the subscription will receive when initializing during your unit test setup phase (Data).');
                }
                subId = 'sub#' + (++subCount);
                publications.subscriptionIds.push(subId);
            }



            return $q.resolve(subId).then(function (subId) {
                publications.subId = subId;
                onPublicationNotficationCallback({
                    name: publications.name,
                    subscriptionId: subId,
                    records: publications.getData(),
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






