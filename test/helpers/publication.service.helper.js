
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







