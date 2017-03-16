angular
    .module('sync.test')
    .provider('$socketio', mockSocketio);

function mockSocketio() {

    var debug;

    this.setDebug = function (value) {
        debug = value;
    };


    this.$get =
        function ($rootScope, $q) {

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
                // var r;
                // var callback = events[event];
                // if (callback) {
                //     $rootScope.$apply(function () {
                //         r = callback(data, acknowledge);

                //     });
                // }
                //  $rootScope.$digest();
                //                 setTimeout(function () {
                //                     $rootScope.$digest();
                //                 }, 100)
                // $rootScope.$digest();
                // return r;
                var callback = events[event];
                return callback?  callback(data, acknowledge):null;
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
        }
}


