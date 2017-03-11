
angular
    .module('sync.test')
    .service('publicationService', publicationService);

function publicationService($sync) {
    var publications = [];
    this.setData = setData;
    this.getData = getData;
    this.update = update;
    this.remove = remove;
    this.findPublication = findPublication;
    this.findPublicationBySubscriptionId = findPublicationBySubscriptionId;


    function findPublicationBySubscriptionId(id) {
        // find the data for this subscription
        return _.find(publications, function (pub) {
            return _.indexOf(pub.subscriptionIds, id) !== -1;
        });
    }

    function findPublication(subParams) {
        // find the data for this subscription
        return _.find(publications, function (pub) {
            return pub.publication === subParams.publication;
        });
    }

    function setData(data, subParams) {
        var pub = findPublication(subParams);
        if (!pub) {
            pub = subParams;
            pub.name = subParams.publication;
            pub.data = {};
            pub.subscriptionIds = [];
            publications.push(pub);
        }

        copyAll(data).forEach(function (record) {
            pub.data[$sync.getIdValue(record)] = record;
        });
    }

    function getData(subParams) {
        // find the data for this subscription
        var pub = findPublication(subParams);
        //return sub?sub.data:null;
        return pub && Object.keys(pub.data).length ? _.values(pub.data) : [];
    }

    function update(data, subParams) {
        var pub = findPublication(subParams);
        if (!pub) {
            throw ('Call setData before update');
        }
        data = copyAll(data);
        data.forEach(function (record) {
            pub.data[$sync.getIdValue(record)] = record;
        });
        return data;
    }

    function remove(data, subParams) {
        var pub = findPublication(subParams);
        if (!pub) {
            throw ('Call setData before remove');
        }
        data = copyAll(data);
        data.forEach(function (record) {
            delete pub.data[$sync.getIdValue(record)];
        });
        return data;
    }

    function copyAll(array) {
        var r = [];
        array.forEach(function (i) {
            r.push(angular.copy(i));
        })
        return r;
    }
}







