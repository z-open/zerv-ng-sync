
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
            return pub.publication === subParams.publication && (
                (subParams.params && pub.params && _.isEqual(subParams.params, pub.params)) ||
                (!subParams.params && !pub.params)
            );
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
            pub.data[$sync.getIdValue(record.id)] = record;
        });
        return pub;
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
            throw ('Attempt to update data from a publication that does NOT exist. You must set the publication during the unit test setup phase (use setData functions).');
        }
        data = copyAll(data);
        data.forEach(function (record) {
            pub.data[$sync.getIdValue(record.id)] = record;
        });
        return data;
    }

    function remove(data, subParams) {
        var pub = findPublication(subParams);
        if (!pub) {
            throw ('Attempt to remove data from a publication that does NOT exist. You must set the publication during the unit test setup phase (use setData functions).');
        }
        data = copyAll(data);
        data.forEach(function (record) {
            delete pub.data[$sync.getIdValue(record.id)];
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







