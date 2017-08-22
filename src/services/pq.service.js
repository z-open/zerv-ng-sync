/**
 * 
 * Service that allows an array of data remain in sync with backend.
 * 
 * 
 * ex:
 * when there is a notification, noticationService notifies that there is something new...then the dataset get the data and notifies all its callback.
 * 
 * NOTE: 
 *  
 * 
 * Pre-Requiste:
 * -------------
 * Sync requires objects have BOTH id and revision fields/properties.
 * 
 * When the backend writes any data to the db that are supposed to be syncronized:
 * It must make sure each add, update, removal of record is timestamped.
 * It must notify the datastream (with notifyChange or notifyRemoval) with some params so that backend knows that it has to push back the data back to the subscribers (ex: the taskCreation would notify with its planId)
 * 
 * 
 */
angular
    .module('zerv.sync')
    .provider('$pq', pgProvider);

function pgProvider() {
    var bluebird;
    this.useBluebird = function() {
        bluebird = true;
    };

    this.$get = function pq($q) {
        if (!bluebird || (bluebird && Promise && !Promise.bind)) {
            return $q;
        }
        console.log('Bluebird');
        return {
            defer: function() {
                var pResolve, pReject;
                var p = new Promise(function(resolve, reject) {
                    pResolve = resolve;
                    pReject = reject;
                });
                return {
                    resolve: function(data) {
                        return pResolve(data);
                    },
                    reject: function(data) {
                        return pReject(data);
                    },
                    promise: p,
                };
            },

            resolve: function(data) {
                return Promise.resolve(data);
            },

            reject: function(data) {
                return Promise.reject(data);
            },

            all: function(promises) {
                return Promise.all(promises);
            },
        };
    };
}
