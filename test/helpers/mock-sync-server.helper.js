
angular
    .module('sync.test')
    .service('mockSyncServer', mockSyncServer);

function mockSyncServer($q, $socketio, $sync, publicationService) {

    var publicationsWithSubscriptions = publicationService;

    var subCount = 0;

    var self = this;
    this.onPublicationNotficationCallback = onPublicationNotficationCallback;
    this.setData = setData;
    this.setArrayData = setArrayData;
    this.setObjectData = setObjectData;
    this.notifyDataChanges = notifyDataChanges;
    this.notifyDataRemovals = notifyDataRemovals;
    this.subscribe = subscribe;
    this.unsubscribe = unsubscribe;
    this.acknowledge = acknowledge;


    $socketio.onFetch('sync.subscribe', function () {
        return self.subscribe.apply(self, arguments);
    });

    $socketio.onFetch('sync.unsubscribe', function () {
        return self.unsubscribe.apply(self, arguments);
    });

    function onPublicationNotficationCallback(data) {
        return $socketio.send('SYNC_NOW', data, self.acknowledge);
    }

    function setArrayData(subParams, data) {
        setData(subParams, data);
    }
    function setObjectData(subParams, obj) {
        setData(subParams, [obj]);
    }

    /**
     * @param data
     * @param <object> subParams
     *   which contains publication and params
     *   if not provided, a default publication will be created
     */
    function setData(subParams, data) {
        return publicationsWithSubscriptions.setData(data, subParams.publication, subParams.params);
    }

    function notifyDataChanges(subParams, data) {
        var publication = publicationsWithSubscriptions.findPublication(subParams.publication, subParams.params);

        if (!publication) {
            throw ('Attempt to update data from a publication that does NOT exist. You must set the publication data during the unit test setup phase (use setData functions).');
        }
        data = publication.update(data);
        return notifySubscriptions(publication, data);
    }

    function notifyDataRemovals(subParams, data) {
        var publication = publicationsWithSubscriptions.findPublication(subParams.publication, subParams.params);

        if (!publication) {
            throw ('Attempt to remove data from a publication that does NOT exist. You must set the publication data during the unit test setup phase (use setData functions).');
        }

        data = publication.remove(data);
        _.forEach(data, function (record) { record.remove = true; });
        return notifySubscriptions(publication, data);
    }

    function notifySubscriptions(publication, data) {
        return $q.all(_.map(publication.subscriptionIds, function (id) {
            return self.onPublicationNotficationCallback({
                name: publication.name,
                subscriptionId: id,
                records: data,
                diff: true
            }, self.acknowledge);
        }));
    }

    function subscribe(subParams) {
        console.log('Subscribe ', subParams);
        var publications;
        var subId;

        if (subParams.id) {
            publications = publicationsWithSubscriptions.findPublicationBySubscriptionId(subParams.id);
            subId = subParams.id;
            if (!publications) {
                throw new Error('Subscription with id [' + subParams.id + '] does not exist.');
            }
        } else {
            publications = publicationsWithSubscriptions.findPublication(subParams.publication, subParams.params);
            if (!publications) {
                throw new Error('Subscription [' + JSON.stringify(subParams) + '] was not initialized with setData. You must define the data that the subscription will receive when initializing during your unit test setup phase (Data).');
            }
            subId = 'sub#' + (++subCount);
            publications.subscriptionIds.push(subId);
        }



        return $q.resolve(subId).then(function (subId) {
            publications.subId = subId;
            self.onPublicationNotficationCallback({
                name: publications.name,
                subscriptionId: subId,
                records: publications.getData(),
            }, self.acknowledge);
            return subId;
        })
    }

    function unsubscribe(data) {
        console.log("Unsubscribed: ", data);
        return $q.resolve();
    }

    function acknowledge(ack) {
        console.log('Client acknowledge receiving data');
    }
}






