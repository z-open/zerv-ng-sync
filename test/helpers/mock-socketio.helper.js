angular
    .module('sync.test')
    .provider('$socketio', mockSocketio);

function mockSocketio() {

    var debug;

    this.setDebug = function (value) {
        debug = value;
    };


    this.$get =
        function ($rootScope, $pq) {

            var self = this;
            this.network = true;
            var events = {},
                calls = {};


            this.onFetch = onFetch;
            this.onPost = onPost;
            this.send = send;

            this.on = on;
            this.fetch = fetch;
            this.post = post;

            return this;

            /**
             *  Register the call back that will be executed on the server side when fetch is called by the client
             */
            function onFetch(operation, callback) {
                logDebug('registering fetch operation [' + operation + '] callback.');
                calls[operation] = callback;
            }

            function onPost(operation, callback) {
                logDebug('registering post operation [' + operation + '] callback.');
                calls[operation] = callback;
            }
            /** 
             *  Send data thru the socket to the client from the server side
             *  This will trigger the event callback on the client side
             * 
             */
            function send(event, data, acknowledge) {
                var callback = events[event];
                return callback ? callback(data, acknowledge) : null;
            }

            /**
             * the client registers to listen so specific event whose server will use to send data to.
             */
            function on(event, callback) {
                // if (!self.network) {
                //     return $pq.defer().promise;
                // }
                logDebug('registering ON event [' + event + '] callback.');
                events[event] = callback;
            }

            /**
             *  The client uses fetch to send data over the server.
             *  Server will react to the fetch via the callback registered with onFetch
             */
            function fetch(operation, data) {
                return call(operation, data);
            }
            function post(operation, data) {
                return call(operation, data);
            }


            function call(operation, data) {
                if (!self.network) {
                    // never returns..
                    return $pq.defer().promise;
                }
                var fn = calls[operation];
                if (fn) {
                    logDebug('Calling ' + operation + ' - ', data);
                    return fn(data);
                }
                throw new Error('Call to undefined operation. Define ' + operation + ' with onFetch or onPost function of $socketio (mockSocketio).');
            }


            function logDebug(msg, data) {
                if (debug) {
                    console.debug('SOCKETIO: ' + msg, data);
                }
            }
        }
}


