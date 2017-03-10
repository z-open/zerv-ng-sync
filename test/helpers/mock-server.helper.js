
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

        function MockBackend() {
            var db = {};
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

            $socketio.onFetch('sync.unsubscribe',  function () {
                return self.unsubscribe.apply(self, arguments);
            });

            function onPublicationNotficationCallback(data) {
                return $socketio.send('SYNC_NOW', data, self.acknowledge);
            }

            function setData(data) {
                copyAll(data).forEach(function (record) {
                    db[$sync.getIdValue(record)] = record;
                });
            }

            function copyAll(array) {
                var r = [];
                array.forEach(function (i) {
                    r.push(angular.copy(i));
                })
                return r;
            }

            function notifyDataChanges(data) {
                data = copyAll(data);
                data.forEach(function (record) {
                    db[$sync.getIdValue(record)] = record;
                })
                if (isSubscribedOnBackend) {
                    return self.onPublicationNotficationCallback({
                        name: 'myPub',
                        subscriptionId: 'sub#1',
                        records: data,
                        diff: true
                    }, self.acknowledge);
                }
            }

            function notifyDataRemovals(data) {
                data = copyAll(data);
                data.forEach(function (record) {
                    record.remove = true;
                    delete db[$sync.getIdValue(record)];
                });
                if (isSubscribedOnBackend) {
                    self.onPublicationNotficationCallback({
                        name: 'myPub',
                        subscriptionId: 'sub#1',
                        records: data,
                        diff: true
                    }, self.acknowledge);
                }
            }

            function subscribe(data) {
                //console.log("fetch: " + operation, data);
                console.log('Subscribe ', data);
                return $q.resolve('sub#1').then(function (subId) {
                    isSubscribedOnBackend = true;
                    self.onPublicationNotficationCallback({
                        name: 'myPub',
                        subscriptionId: subId,
                        records: Object.keys(db).length ? _.values(db) : []
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




