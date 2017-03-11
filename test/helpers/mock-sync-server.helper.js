
angular
    .module('sync.test')
    .service('mockSyncServer', mockSyncServer);

function mockSyncServer($q, $socketio, $sync, publicationService) {

    var publicationsWithSubscriptions = publicationService;
    var defaultPublication = {};
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

    function setArrayData(data, subParams) {
        setData(data, subParams);
    }
    function setObjectData(obj, subParams) {
        setData([obj], subParams);
    }

    function setData(data, subParams) {
        var publication = publicationsWithSubscriptions.setData(data, subParams || defaultPublication);
    }

    function notifyDataChanges(data, subParams) {
        var publication = subParams ? publicationsWithSubscriptions.findPublication(subParams) : defaultPublication;
        data = publicationsWithSubscriptions.update(data, publication);
        return notifySubscriptions(publication, data);
    }

    function notifyDataRemovals(data, subParams) {
        var publication = subParams ? publicationsWithSubscriptions.findPublication(subParams) : defaultPublication;
        data = publicationsWithSubscriptions.remove(data, publication);
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
        if (!defaultPublication.name) {
            //defaultSub.publication = params.publication;
            _.assign(defaultPublication, subParams);
            defaultPublication.name = subParams.publication;
            defaultPublication.params = subParams.params;
            subscriptions = defaultPublication;
            subId = 'sub#' + 0;
            subscriptions.subscriptionIds = [subId];
        } else {
            if (subParams.id) {
                subscriptions = publicationsWithSubscriptions.findPublicationBySubscriptionId(subParams.id);
                subId = subParams.id;
                if (!subscriptions) {
                    throw new Error('Subscription with id [' + subParams.id + '] does not exist.');
                }
            } else {
                subscriptions = publicationsWithSubscriptions.findPublication(subParams);
                if (!subscriptions) {
                    throw new Error('Subscription [' + JSON.stringify(subParams) + '] was not initialized with setData. Check your unit test setup.');
                }
                subId = 'sub#' + (++subCount);
                subscriptions.subscriptionIds.push(subId);
            }

        }

        return $q.resolve(subId).then(function (subId) {
            subscriptions.subId = subId;
            isSubscribedOnBackend = true;
            self.onPublicationNotficationCallback({
                name: subscriptions.publication,
                subscriptionId: subscriptions.subId,
                records: publicationsWithSubscriptions.getData(subscriptions)
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






