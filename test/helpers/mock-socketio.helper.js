angular
    .module('sync.test')
    .service('$socketio', mockSocketio);

function mockSocketio($q) {

    var self = this;
    this.network = true;
    var events = {}, 
    fetches = {};


    this.onFetch = onFetch;
    this.send = send;

    this.on = on;
    this.fetch = fetch;


    /**
     *  Register the call back that will be executed on the server side when fetch is called by the client
     */
    function onFetch(operation, callback) {
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
        console.log("ON: " + event);
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
            console.log('Fetching ' + operation + ' - ', data);
            return fn(data);
        }
    }
}


