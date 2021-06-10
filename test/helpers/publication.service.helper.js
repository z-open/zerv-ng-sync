
angular
    .module('sync.test')
    .service('publicationService', publicationService);

function publicationService($sync) {
    var publications = [];
    this.create = create;
    this.release = release;
    this.find = find;
    this.findBySubscriptionId = findBySubscriptionId;


    function findBySubscriptionId(id) {
        // find the data for this subscription
        return _.find(publications, function(pub) {
            return _.indexOf(pub.subscriptionIds, id) !== -1;
        });
    }

    function find(name, params) {
        // find the data for this subscription
        return _.find(publications, function(pub) {
            return pub.name === name && (
                (params && pub.params && _.isEqual(params, pub.params)) ||
                (!params && !pub.params)
            );
        });
    }

    function create(data, name, params) {
        var pub = find(name, params);
        if (!pub) {
            pub = new Publication(name, params);
            publications.push(pub);
        }
        pub.reset(data);
        return pub;
    }

    function release(subId, name, params) {
        var pub = find(name, params);
        if (pub) {
            if (pub.subscriptionIds.indexOf(subId) !== -1) {
                _.pull(pub.subscriptionIds, subId);
                // if (pub.subscriptionIds.length === 0) {
                //   _.remove(publications, pub);
                // }
            }
        }
    }


    function copyAll(array) {
        var r = [];
        array.forEach(function(i) {
            if (!_.isObject(i)) {
                throw new Error('Publication data cannot be null');
            }
            r.push(angular.copy(i));
        });
        return r;
    }

    function Publication(name, params) {
        this.cache = {};
        this.name = name;
        this.params = params || {};
        this.subscriptionIds = [];
    }

    Publication.prototype.hasSubscriptions = function() {
        return this.subscriptionIds.length > 0;
    };

    Publication.prototype.reset = function(data) {
        this.cache = {};
        this.update(data);
        return data;
    };

    Publication.prototype.update = function(data) {
        var self = this;
        data = copyAll(data);
        data.forEach(function(record) {
            self.cache[$sync.getIdValue(record.id)] = record;
        });
        return data;
    };

    Publication.prototype.remove = function(data) {
        var self = this;
        data = copyAll(data);
        data.forEach(function(record) {
            delete self.cache[$sync.getIdValue(record.id)];
        });
        return data;
    };

    Publication.prototype.getData = function() {
        return _.values(this.cache);
    };
}


