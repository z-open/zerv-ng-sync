
angular
    .module('sync.test')
    .provider('mockServer', service);

function service() {
    var $q;
    var backend;
    // this.socketio = new MockSocketio();

    this.$get = function ($q, $socketio, $sync) {

        backend = new MockBackend();

        return backend;

        function Db() {
            var publications = [];
            this.setData = setData;
            this.getData = getData;
            this.update = update;
            this.remove = remove;
            this.findPublication = findPublication;
            this.findPublicationBySubscriptionId = findPublicationBySubscriptionId;



            function findPublicationBySubscriptionId(id) {
                // find the data for this subscription
                return _.find(publications, function (pub) {
                    return _.indexOf(pub.ids, id) !== -1;
                });
            }

            function findPublication(subParams) {
                // find the data for this subscription
                return _.find(publications, function (pub) {
                    return pub.publication === subParams.publication;
                });
            }

            function setData(data, subParams) {
                var pub = findPublication(subParams);
                if (!pub) {
                    pub = subParams;
                    pub.data = {};
                    pub.ids = [];
                    publications.push(pub);
                }

                copyAll(data).forEach(function (record) {
                    pub.data[$sync.getIdValue(record)] = record;
                });
            }

            function getData(subParams) {
                // find the data for this subscription
                var pub = findPublication(subParams);
                //return sub?sub.data:null;
                return pub && Object.keys(pub.data).length ? _.values(pub.data) : [];
            }

            function update(data, subParams) {
                var pub = findPublication(subParams);
                if (!pub) {
                    throw ('Call setData before update');
                }
                data = copyAll(data);
                data.forEach(function (record) {
                    pub.data[$sync.getIdValue(record)] = record;
                });
                return data;
            }

            function remove(data, subParams) {
                var pub = findPublication(subParams);
                if (!pub) {
                    throw ('Call setData before remove');
                }
                data = copyAll(data);
                data.forEach(function (record) {
                    delete pub.data[$sync.getIdValue(record)];
                });
                return data;
            }

            function copyAll(array) {
                var r = [];
                array.forEach(function (i) {
                    r.push(angular.copy(i));
                })
                return r;
            }
        }

        function MockBackend() {
            var publicationsWithSubscriptions = new Db();
            var defaultSub = {};
            var subCount = 0;

            var isSubscribedOnBackend = false;

            var self = this;
            this.onPublicationNotficationCallback = onPublicationNotficationCallback;
            this.setData = setData;
            this.notifyDataChanges = notifyDataChanges;
            this.notifyDataRemovals = notifyDataRemovals;
            this.subscribe = subscribe;
            this.unsubscribe = unsubscribe;
            this.acknowledge = acknowledge;

            $socketio.onFetch('sync.subscribe', function () {
                return self.subscribe.apply(self, arguments);
            });

            $socketio.onFetch('sync.unsubscribe', function () {
                return self.unsubscribe.apply(self, arguments);
            });

            function onPublicationNotficationCallback(data) {
                return $socketio.send('SYNC_NOW', data, self.acknowledge);
            }

            function setData(data, subParams) {
                subParams = subParams || defaultSub;
                return publicationsWithSubscriptions.setData(data, subParams);
            }

            function notifyDataChanges(data, subParams) {
                subscriptions = subParams ? publicationsWithSubscriptions.findPublication(subParams) : defaultSub;
                data = publicationsWithSubscriptions.update(data, subscriptions);
                if (isSubscribedOnBackend) {
                    return notifySubscriptions(subscriptions, data);
                }
            }

            function notifyDataRemovals(data, subParams) {
                subscriptions = subParams ? publicationsWithSubscriptions.findPublication(subParams) : defaultSub;
                data = publicationsWithSubscriptions.remove(data, subscriptions);
                _.forEach(data, function (record) { record.remove = true; });

                if (isSubscribedOnBackend) {
                    return notifySubscriptions(subscriptions, data);
                }
            }

            function notifySubscriptions(publication, data) {
                return $q.all(_.map(publication.ids, function (id) {
                    return self.onPublicationNotficationCallback({
                        name: publication.publication,
                        subscriptionId: id,
                        records: data,
                        diff: true
                    }, self.acknowledge);
                }));
            }

            function subscribe(params) {
                console.log('Subscribe ', params);
                var subscriptions;
                var subId;
                if (!defaultSub.publication) {
                    //defaultSub.publication = params.publication;
                    _.assign(defaultSub, params);
                    subscriptions = defaultSub;
                    subId = 'sub#' + 0;
                    subscriptions.ids = [subId];


                } else {
                    if (params.id) {
                        subscriptions = publicationsWithSubscriptions.findPublicationBySubscriptionId(params.id);
                        subId = params.id;
                    } else {
                        subscriptions = publicationsWithSubscriptions.findPublication(params);
                        subId = 'sub#' + (++subCount);
                        subscriptions.ids.push(subId);
                    }
                    if (!subscriptions) {
                        throw new Error('Subscription was not initialized with setData.');
                    }
                }




                return $q.resolve(subId).then(function (subId) {
                    subscriptions.subId = subId;
                    isSubscribedOnBackend = true;
                    self.onPublicationNotficationCallback({
                        name: subscriptions.publication,
                        subscriptionId: subscriptions.subId,
                        records: publicationsWithSubscriptions.getData(subscriptions)
                    }, self.acknowledge);
                    return subId;
                })
            }

            function unsubscribe(data) {
                console.log("Unsubscribed: ", data);
                isSubscribedOnBackend = false;
                return $q.resolve();
            }

            function acknowledge(ack) {
                console.log('Client acknowledge receiving data');
            }
        }
    }
}




