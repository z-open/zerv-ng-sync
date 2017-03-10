angular
    .module('sync.test')
    .service('$socketio', MockSocketio);

function MockSocketio($q) {

    var self = this;
    this.network = true;
    var events = {}, fetches = {};

    this.onFetch = function (operation, callback) {
        fetches[operation] = callback;
    }
    this.send = function (event, data, acknowledge) {
        var callback = events[event];
        if (callback) {
            return callback(data, acknowledge);
        }
        return null;
    }

    this.on = function (event, callback) {
        // if (!self.network) {
        //     return $q.defer().promise;
        // }
        console.log("ON: " + event);
        events[event] = callback;


        // if (event === 'SYNC_NOW') {
        //     self.backend.onPublicationNotficationCallback = callback;
        // }
    }
    this.fetch = function (operation, data) {
        if (!self.network) {
            // never returns..
            return $q.defer().promise;
        }
        var fn = fetches[operation];
        if (fn) {
             console.log('Fetching '+operation+' - ',data);
            return fn(data);
        }
        // if (operation === 'sync.subscribe') {
        //     return self.backend.subscribe(data);
        // }
        // if (operation === 'sync.unsubscribe') {
        //     return self.backend.unsubscribe(data);
        // }
    }
}


