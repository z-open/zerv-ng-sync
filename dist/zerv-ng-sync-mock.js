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
            publishArray: publishArray,
            publishObject: publishObject,
            publish: publish,

            notifyDataCreation: notifyDataUpdate,
            notifyDataUpdate: notifyDataUpdate,
            notifyDataDelete: notifyDataDelete,

            // useful for spying the internals
            subscribe: subscribe,
            unsubscribe: unsubscribe,
            acknowledge: acknowledge,

            setData: setData
        }

        $socketio.onFetch('sync.subscribe', function () {
            return service.subscribe.apply(self, arguments);
        });

        $socketio.onFetch('sync.unsubscribe', function () {
            return service.unsubscribe.apply(self, arguments);
        });

        return service;


        /**
         * Declare a new publication and the array of data that will be returned to a subscription at initial fetch.
         * 
         * @param {object} subParams object contains the following fields
         *      - {String} publication : name of the publication to create
         *      - {Object} params: subscription params corresponding to the data returned
         * @param {array} data: Array of objects/records that will be returned. Each item must have an id and revision number
         * 
         * @returns {Object} the publication object
         */
        function publishArray(subParams, array) {
            if (!_.isArray(array)) {
                throw new Error('Parameter data must be an array');
            }
            return setData(subParams, array);
        }

        /**
         * Declare a new publication and the object that will be returned to a subscription at initial fetch.
         * 
         * @param {object} subParams object contains the following fields
         *      - {String} publication : name of the publication to create
         *      - {Object} params: subscription params corresponding to the data returned
         * @param {Object} obj:  object/record that will be returned. The item must have an id and revision number
         * 
         * @returns {Object} the publication object
         */
        function publishObject(subParams, obj) {
            if (!_.isObject(obj) || _.isArray(obj)) {
                throw new Error('Parameter obj must be an object including publication and params fields');
            }
            return setData(subParams, [obj]);
        }

        /**
         * Declare one or multiple publications and their assotiated data to be returned to the subscription at initialization.
         * 
         * @param {array} array of object or single object containing the following information
         * 
         *      - {String} type: 'array' or 'object'
         *      - {object} sub:  object contains the following fields
         *         - {String} publication : name of the publication to create
         *         - {Object} params: subscription params corresponding to the data returned
         *      - {Object} data:  array of object or single object that will be returned. The item must have an id and revision number
         * 
         */
        function publish(definition) {
            if (_.isArray(definition)) {
                _.forEach(definition, function (def) {
                    if (!def.type) {
                        throw new Error('Publish array argument must contain objects with a type property ("object" or "array")');
                    }
                    if (def.type === 'array') {
                        publishArray(def.sub, def.data);
                    } else {
                        publishObject(def.sub, def.data);
                    }
                })
            } else if (_.isObject(definition)) {
                publishObject(definition.sub, definition.data);
            } else {
                throw new Error('Publish argument must be an array or an object');
            }
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




        function notifyDataUpdate(subParams, data) {
            var publication = publicationsWithSubscriptions.findPublication(subParams.publication, subParams.params);

            if (!publication) {
                throw ('Attempt to update data from a publication that does NOT exist. You must set the publication data during the unit test setup phase (use setData functions).');
            }
            data = publication.update(data);
            return notifySubscriptions(publication, data);
        }

        function notifyDataDelete(subParams, data) {
            var publication = publicationsWithSubscriptions.findPublication(subParams.publication, subParams.params);

            if (!publication) {
                throw ('Attempt to remove data from a publication that does NOT exist. You must set the publication data during the unit test setup phase (use setData functions).');
            }

            data = publication.remove(data);
            _.forEach(data, function (record) { record.remove = new Date(); });
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

        function onPublicationNotficationCallback(data) {
            return $socketio.send('SYNC_NOW', data, service.acknowledge);
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
