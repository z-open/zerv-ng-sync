(function() {
"use strict";

angular
    .module('sync.test', []);
}());

(function() {
"use strict";

angular
    .module('sync.test')
    .provider('$socketio', mockSocketio);

function mockSocketio() {

    var debug;

    this.setDebug = function (value) {
        debug = value;
    };


    this.$get =
        ["$q", function ($q) {

            var self = this;
            this.network = true;
            var events = {},
                fetches = {};


            this.onFetch = onFetch;
            this.send = send;

            this.on = on;
            this.fetch = fetch;

            return this;

            /**
             *  Register the call back that will be executed on the server side when fetch is called by the client
             */
            function onFetch(operation, callback) {
                logDebug('registering fetch operation [' + operation + '] callback.');
                fetches[operation] = callback;
            }

            /** 
             *  Send data thru the socket to the client from the server side
             *  This will trigger the event callback on the client side
             * 
             */
            function send(event, data, acknowledge) {
                var callback = events[event];
                if (callback) {
                    return callback(data, acknowledge);
                }
                return null;
            }

            /**
             * the client registers to listen so specific event whose server will use to send data to.
             */
            function on(event, callback) {
                // if (!self.network) {
                //     return $q.defer().promise;
                // }
                logDebug('registering ON event [' + event + '] callback.');
                events[event] = callback;
            }

            /**
             *  The client uses fetch to send data over the server.
             *  Server will react to the fetch via the callback registered with onFetch
             */
            function fetch(operation, data) {
                if (!self.network) {
                    // never returns..
                    return $q.defer().promise;
                }
                var fn = fetches[operation];
                if (fn) {
                    logDebug('Fetching ' + operation + ' - ', data);
                    return fn(data);
                }
            }
            function logDebug(msg) {
                if (debug) {
                    console.debug('SOCKETIO: ' + msg);
                }
            }
        }]
}
}());

(function() {
"use strict";

angular
    .module('sync.test')
    .provider('mockSyncServer', mockSyncServer);

function mockSyncServer() {

    var debug;

    this.setDebug = function (value) {
        debug = value;
    };


    this.$get = ["$q", "$socketio", "$sync", "publicationService", function sync($q, $socketio, $sync, publicationService) {

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
    }]
}
}());

(function() {
"use strict";

publicationService.$inject = ["$sync"];
angular
    .module('sync.test')
    .service('publicationService', publicationService);

function publicationService($sync) {
    var publications = [];
    this.setData = setData;
    this.getData = getData;
    this.findPublication = findPublication;
    this.findPublicationBySubscriptionId = findPublicationBySubscriptionId;


    function findPublicationBySubscriptionId(id) {
        // find the data for this subscription
        return _.find(publications, function (pub) {
            return _.indexOf(pub.subscriptionIds, id) !== -1;
        });
    }

    function findPublication(name, params) {
        // find the data for this subscription
        return _.find(publications, function (pub) {
            return pub.name === name && (
                (params && pub.params && _.isEqual(params, pub.params)) ||
                (!params && !pub.params)
            );
        });
    }

    function setData(data, name, params) {
        var pub = findPublication(name, params);
        if (!pub) {
            pub = new Publication(name, params);
            publications.push(pub);
        }
        pub.reset(data);
        return pub;
    }

    function getData(publication, params) {
        // find the data for this subscription
        var pub = findPublication(publication, params);
        return pub && Object.keys(pub.data).length ? _.values(pub.data) : [];
    }


    function copyAll(array) {
        var r = [];
        array.forEach(function (i) {
            r.push(angular.copy(i));
        })
        return r;
    }

    function Publication(name, params) {
        this.cache = {};
        this.name = name;
        this.params = params || {};
        this.subscriptionIds = [];
    }

    Publication.prototype.reset = function (data) {
        this.cache = {};
        this.update(data);
        return data;
    }

    Publication.prototype.update = function (data) {
        var self = this;
        data = copyAll(data);
        data.forEach(function (record) {
            self.cache[$sync.getIdValue(record.id)] = record;
        });
        return data;
    }

    Publication.prototype.remove = function (data) {
        var self = this;
        data = copyAll(data);
        data.forEach(function (record) {
            delete self.cache[$sync.getIdValue(record.id)];
        });
        return data;
    }

    Publication.prototype.getData = function () {
        return _.values(this.cache);
    }
}
}());
