
angular
    .module('sync.test')
    .service('mockSyncServer', mockSyncServer);

function mockSyncServer($q, $socketio, $sync, publicationService) {

    var publicationsWithSubscriptions = publicationService;

    var subCount = 0;

    var isSubscribedOnBackend = false;

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
        return publicationsWithSubscriptions.setData(data, subParams);
    }

    function notifyDataChanges(subParams, data) {
        var publication = publicationsWithSubscriptions.findPublication(subParams);
        data = publicationsWithSubscriptions.update(data, subParams);
        return notifySubscriptions(publication, data);
    }

    function notifyDataRemovals(subParams, data) {
        var publication = publicationsWithSubscriptions.findPublication(subParams);
        data = publicationsWithSubscriptions.remove(data, subParams);
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
        var subscriptions;
        var subId;

        if (subParams.id) {
            subscriptions = publicationsWithSubscriptions.findPublicationBySubscriptionId(subParams.id);
            subId = subParams.id;
            if (!subscriptions) {
                throw new Error('Subscription with id [' + subParams.id + '] does not exist.');
            }
        } else {
            subscriptions = publicationsWithSubscriptions.findPublication(subParams);
            if (!subscriptions) {
                throw new Error('Subscription [' + JSON.stringify(subParams) + '] was not initialized with setData. You must define the data that the subscription will receive when initializing during your unit test setup phase (Data).');
            }
            subId = 'sub#' + (++subCount);
            subscriptions.subscriptionIds.push(subId);
        }



        return $q.resolve(subId).then(function (subId) {
            subscriptions.subId = subId;
            isSubscribedOnBackend = true;
            self.onPublicationNotficationCallback({
                name: subscriptions.name,
                subscriptionId: subId,
                records: _.values(subscriptions.data),//publicationsWithSubscriptions.getData(subscriptions)
            }, self.acknowledge);
            return subId;
        })
    }

    function unsubscribe(data) {
        console.log("Unsubscribed: ", data);
        isSubscribedOnBackend = false;
        return $q.resolve();
    }

    function acknowledge(ack) {
        console.log('Client acknowledge receiving data');
    }
}






