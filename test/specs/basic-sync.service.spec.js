describe('Basic Incremental facility: ', function() {
    let spec;

    beforeEach(module('sync.test'));
    beforeEach(module('zerv.sync'));
    beforeEach(inject(function(_$sync_) {
        spec = {
            $sync: _$sync_,
        };
    }));

    it('should check that zjonlib is installed properly', () => {
        // zjsonbin should be installed properly
        expect(window.ZJSONBIN.mergeChanges).toBeDefined();
        expect(window.ZJSONBIN.differenceBetween).toBeDefined();
    });

    it('should delegate to zjonlib functions', () => {
        expect(spec.$sync.mergeChanges).toBe(window.ZJSONBIN.mergeChanges);
        expect(spec.$sync.differenceBetween).toBe(window.ZJSONBIN.differenceBetween);
    });
});

describe('Basic Sync Service: ', function() {
    var $rootScope;
    var backend;
    var spec;
    var subParams = {publication: 'myPub', params: {}};


    beforeEach(module('zerv.sync'));
    beforeEach(module('sync.test'));

    beforeEach(module(function($provide,
        $syncProvider, $socketioProvider, mockSyncServerProvider, $pqProvider) {
        // $pqProvider.useBluebird();
        $syncProvider.setDebug(2);
        mockSyncServerProvider.setDebug(true);
        $socketioProvider.setDebug(true);
        $provide.factory('currentService', function() {
            return {};
        });
    }));


    beforeEach(inject(function(_$rootScope_, mockSyncServer, _$sync_, _$q_, _$syncGarbageCollector_, _$socketio_, sessionUser) {
        $rootScope = _$rootScope_;
        $q = _$q_;

        backend = mockSyncServer;

        var syncCallbacks = {
            onUpdate: function() { },
            onRemove: function() { },
            onAdd: function() { },
            onReady: function() { },
        };

        spec = {
            syncCallbacks: syncCallbacks,
            garbageCollector: _$syncGarbageCollector_,
            $sync: _$sync_,
            $socketio: _$socketio_,
            sessionUser: sessionUser,
        };

        jasmine.clock().install();
        jasmine.clock().mockDate();
    }));

    beforeEach(function setupData() {
        spec.r1 = {id: 1, description: 'person1', revision: 0};
        spec.r1b = {id: 1, description: 'personOne', revision: 1};
        spec.r2 = {id: 2, description: 'person2', revision: 4};
        spec.r3 = {id: 3, description: 'person3', revision: 5};
        spec.recordWithNoRevision = {id: 44, description: 'person44'};

        spec.rc1 = {id: {id1: 1, id2: 1}, description: 'person1', revision: 0};
        spec.rc1b = {id: {id1: 1, id2: 1}, description: 'personOne', revision: 1};
        spec.rc2 = {id: {id1: 2, id2: 1}, description: 'person2', revision: 4};
        spec.rc3 = {id: {id1: 3, id2: 1}, description: 'person3', revision: 5};


        Person = definePersonClass();
        spec.p1 = new Person({id: 1, firstname: 'Tom', lastname: 'Great', revision: 1});
        spec.p1b = new Person({id: 1, firstname: 'Tom', lastname: 'Greater', revision: 2});
        spec.p2 = new Person({id: 2, firstname: 'John', lastname: 'Super', revision: 1});

        spec.sessionUser.sessionId = 'mySessionId';
    });


    beforeEach(function setupSpies() {
        spyOn(backend, 'subscribe').and.callThrough();
        spyOn(backend, 'unsubscribe').and.callThrough();
        spyOn(backend, 'acknowledge');

        spyOn(spec.$socketio, 'fetch').and.callThrough();

        spyOn(spec.garbageCollector, 'dispose').and.callThrough();
        spyOn(spec.garbageCollector, 'run').and.callThrough();

        spyOn(spec.syncCallbacks, 'onUpdate');
        spyOn(spec.syncCallbacks, 'onRemove');
        spyOn(spec.syncCallbacks, 'onAdd');
        spyOn(spec.syncCallbacks, 'onReady');
    });


    afterEach(function() {
        jasmine.clock().tick(10000);
        jasmine.clock().uninstall();
    });


    it('should subscribe and acknowledge to receive empty list', function(done) {
        backend.setData(subParams, []);
        expect(backend.acknowledge).not.toHaveBeenCalled();
        spec.sds = spec.$sync.subscribe('myPub');
        expect(spec.sds.isSyncing()).toBe(false);
        expect(backend.subscribe).not.toHaveBeenCalled();
        var promise = spec.sds.waitForDataReady();
        expect(backend.subscribe).toHaveBeenCalled();
        expect(spec.sds.isSyncing()).toBe(true);
        expect(backend.unsubscribe).not.toHaveBeenCalled();
        promise.then(function(data) {
            expect(backend.acknowledge).toHaveBeenCalled();
            expect(data.length).toBe(0);
            done();
        });
        $rootScope.$digest();
    });

    it('should subscribe and run the waitForDataReady callback', function(done) {
        backend.setData(subParams, [spec.r1, spec.r2]);
        spec.sds = spec.$sync.subscribe('myPub');
        spec.sds.waitForDataReady(function(data, sds) {
            expect(data.length).toBe(2);
            expect(sds).toBe(spec.sds);
            done();
        });
        $rootScope.$digest();
    });

    it('should subscribe and run the waitForSubscriptionReady callback', function(done) {
        backend.setData(subParams, [spec.r1, spec.r2]);
        spec.sds = spec.$sync.subscribe('myPub');
        spec.sds.waitForSubscriptionReady(function(sds) {
            expect(sds).toBe(spec.sds);
            done();
        });
        $rootScope.$digest();
    });
    it('should subscribe and acknowledge to receive inital data', function(done) {
        backend.setData(subParams, [spec.r1, spec.r2]);
        expect(backend.acknowledge).not.toHaveBeenCalled();
        spec.sds = spec.$sync.subscribe('myPub');
        expect(spec.sds.isSyncing()).toBe(false);
        var promise = spec.sds.waitForDataReady();
        expect(spec.sds.isSyncing()).toBe(true);
        promise.then(function(data) {
            expect(backend.acknowledge).toHaveBeenCalled();
            expect(data.length).toBe(2);
            expect(!!_.find(data, spec.r1)).toBe(true);
            expect(!!_.find(data, spec.r2)).toBe(true);
            done();
        });
        $rootScope.$digest();
    });

    describe('Syncing activity', function() {
        beforeEach(function() {
            backend.setData(subParams, [spec.r1, spec.r2]);
            spec.sds = spec.$sync.subscribe('myPub');
        });

        it('should have an empty cache right after subscribing', () => {
            expect(spec.sds.isEmpty()).toBe(true);
        });

        it('should NOT start right after subscribing', function() {
            expect(spec.sds.isSyncing()).toBe(false);
        });

        it('should start when setting syncing to on', function() {
            spec.sds.syncOn();
            expect(spec.sds.isSyncing()).toBe(true);
        });

        it('should start when setting params', function() {
            spec.sds.setParameters();
            expect(spec.sds.isSyncing()).toBe(true);
        });

        it('should start when waiting on data ready', function() {
            spec.sds.waitForDataReady();
            expect(spec.sds.isSyncing()).toBe(true);
        });

        it('should start when waiting on subscription is ready', function(done) {
            var promise = spec.sds.waitForSubscriptionReady();
            expect(spec.sds.isSyncing()).toBe(true);
            promise.then(function(sub) {
                expect(spec.sds).toEqual(sub);
                done();
            });
            $rootScope.$digest();
        });
    });

    it('should release subscription in mockSyncServer', function(done) {
        // works in chrome with bluebird but not in phantomJs

        expect(backend.exists(subParams)).toBe(false);
        backend.setData(subParams, []);
        spec.sds = spec.$sync.subscribe('myPub').syncOn();
        expect(backend.exists(subParams)).toBe(true);

        spec.sds.waitForDataReady().then(function() {
            spec.sds.destroy();
            expect(backend.exists(subParams)).toBe(false);
            done();
        });

        $rootScope.$digest();
    });

    it('should not be in destroyed state on subcription creation', () => {
        backend.setData(subParams, []);
        spec.sds = spec.$sync.subscribe('myPub');
        expect(spec.sds.isDestroyed()).toBe(false);
        spec.sds.waitForDataReady();
        $rootScope.$digest();
        expect(spec.sds.isDestroyed()).toBe(false);
    });

    it('should unsubscribe when subscription is destroyed', () => {
        backend.setData(subParams, []);
        spec.sds = spec.$sync.subscribe('myPub');
        spec.sds.waitForDataReady();
        $rootScope.$digest();
        expect(spec.sds.isSyncing()).toBe(true);
        expect(backend.unsubscribe).not.toHaveBeenCalled();
        spec.sds.destroy();
        expect(spec.sds.isSyncing()).toBe(false);
        expect(backend.unsubscribe).toHaveBeenCalled();
        expect(spec.sds.isDestroyed()).toBe(true);
    });

    it('should unsubscribe when attached scope is destroyed', () => {
        backend.setData(subParams, []);
        var scope = $rootScope.$new();
        spec.sds = spec.$sync.subscribe('myPub');
        spec.sds.attach(scope);
        spec.sds.waitForDataReady();
        $rootScope.$digest();
        expect(spec.sds.isSyncing()).toBe(true);
        scope.$destroy();
        expect(spec.sds.isSyncing()).toBe(false);
        expect(backend.unsubscribe).toHaveBeenCalled();
        expect(spec.sds.isDestroyed()).toBe(true);
    });

    it('should unsubscribe when provided scope is destroyed', () => {
        backend.setData(subParams, []);
        var scope = $rootScope.$new();
        spec.sds = spec.$sync.subscribe('myPub', scope);
        spec.sds.waitForDataReady();
        $rootScope.$digest();
        expect(spec.sds.isSyncing()).toBe(true);
        expect(backend.unsubscribe).not.toHaveBeenCalled();
        scope.$destroy();
        expect(spec.sds.isSyncing()).toBe(false);
        expect(backend.unsubscribe).toHaveBeenCalled();
        expect(spec.sds.isDestroyed()).toBe(true);
    });

    it('should not start syncing on a destroyed subscription', () => {
        backend.setData(subParams, []);
        var scope = $rootScope.$new();
        spec.sds = spec.$sync.subscribe('myPub', scope);
        spec.sds.waitForDataReady();
        expect(spec.sds.isSyncing()).toBe(true);
        scope.$destroy();
        spec.sds.waitForDataReady();
        expect(spec.sds.isSyncing()).toBe(false);
        expect(spec.sds.isDestroyed()).toBe(true);
    });

    // it('should not allow attaching a different scope after initialization', function () {
    //     spec.sds = spec.$sync.subscribe('myPub');
    //     spec.sds.waitForDataReady();

    // });

    // it('should not allow changing to single object synchronization mode after initialization', function () {
    // });

    it('should not allow changing to set the object class after starting syncing', function() {
        backend.setData(subParams, []);
        spec.sds = spec.$sync.subscribe('myPub');
        spec.sds.waitForDataReady();
        spec.sds.setObjectClass(Person);
        expect(spec.sds.getObjectClass()).toBeUndefined();
    });

    describe('Data Array sync', function() {
        beforeEach(function() {
            backend.setData(subParams, [spec.r1, spec.r2]);
            spec.sds = spec.$sync.subscribe('myPub');
        });

        it('should receive an array', function(done) {
            spec.sds.waitForDataReady(function(data) {
                expect(_.isArray(data)).toBe(true);
                done();
            });
            $rootScope.$digest();
        });

        it('should NOT allow syncing data without revision property', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                backend.notifyDataCreation(subParams, [spec.recordWithNoRevision]).
                    catch(function(err) {
                        expect(err.message).toBe('Sync requires a revision or timestamp property in received record');
                        done();
                    });
            });
            $rootScope.$digest();
        });

        // one or list to test... check if instance is maintained too.
        it('should add a record to the array when receiving an add operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.length).toBe(2);
                backend.notifyDataCreation(subParams, [spec.r3])
                    .then(function() {
                        expect(data.length).toBe(3);
                        expect(!!_.find(data, {id: spec.r3.id})).toBe(true);
                        done();
                    });
            });
            $rootScope.$digest();
        });

        it('should update existing record in the array when receiving an update operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.length).toBe(2);
                var rec = _.find(data, {id: spec.r1.id});
                backend.notifyDataUpdate(subParams, [spec.r1b])
                    .then(function() {
                        expect(data.length).toBe(2);
                        expect(rec).toBeDefined();
                        expect(rec.description).toBe(spec.r1b.description);
                        done();
                    });
            });
            $rootScope.$digest();
        });

        it('should remove a record from array when receiving a removal operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.length).toBe(2);
                backend.notifyDataDelete(subParams, [{id: spec.r2.id, revision: spec.r2.revision + 1}]);
                $rootScope.$evalAsync(function() {
                    expect(data.length).toBe(1);
                    expect(_.find(data, {id: spec.r2.id})).not.toBeDefined();
                    done();
                });
            });
            $rootScope.$digest();
        });
    });


    describe('Data Array sync with composite key', function() {
        beforeEach(function() {
            backend.setData(subParams, [spec.rc1, spec.rc2]);
            spec.sds = spec.$sync.subscribe('myPub');
        });

        it('should receive an array', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(_.isArray(data)).toBe(true);
                expect(data.length).toBe(2);
                done();
            });
            $rootScope.$digest();
        });

        // one or list to test... check if instance is maintained too.
        it('should add a record to the array when receiving an add operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.length).toBe(2);
                backend.notifyDataCreation(subParams, [spec.rc3])
                    .then(function() {
                        expect(data.length).toBe(3);
                        expect(!!findRecord(data, spec.rc3.id)).toBe(true);
                        done();
                    });
            });
            $rootScope.$digest();
        });

        it('should update existing record in the array when receiving an update operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.length).toBe(2);
                var rec = _.find(data, {id: spec.rc1.id});
                backend.notifyDataUpdate(subParams, [spec.rc1b])
                    .then(function() {
                        expect(data.length).toBe(2);
                        expect(rec).toBeDefined();
                        expect(rec.description).toBe(spec.rc1b.description);
                        done();
                    });
            });
            $rootScope.$digest();
        });

        it('should remove a record from array when receiving a removal operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.length).toBe(2);
                var p = backend.notifyDataDelete(subParams, [{id: spec.rc2.id, revision: spec.rc2.revision + 1}]);
                p.then(function() {
                    expect(data.length).toBe(1);
                    expect(findRecord(data, spec.r2.id)).not.toBeDefined();
                    done();
                });
            });
            $rootScope.$digest();
        });
    });

    function findRecord(data, id) {
        return _.find(data, function(record) {
            return spec.$sync.getIdValue(record.id) === spec.$sync.getIdValue(id);
        }
        );
    }

    describe('Single record sync with incrementals', function() {
        beforeEach(function() {
            backend.setData(subParams, [spec.r1]);
            spec.sds = spec.$sync.subscribe('myPub')
                .setSingle(true)
                .enableIncrementalChanges();
            $rootScope.$digest();
        });

        it('should receive an object and have set an untouched json object', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(_.isArray(data)).toBe(false);
                expect(data.timestamp.$untouched).toEqual({
                    id: 1,
                    description: 'person1',
                    revision: 0,
                    timestamp: {},
                });
                done();
            });
            $rootScope.$digest();
        });

        it('should return modifications made to the record', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                // let's modified instance returned by sync
                data.description = 'personOne';
                // can sync detect the differences?
                const diff = spec.sds.getCurrentModifications();
                expect(diff).toEqual({description: 'personOne'});
                done();
            });
            $rootScope.$digest();
        });
    });

    describe('Single record sync without incrementals', function() {
        beforeEach(function() {
            backend.setData(subParams, [spec.r1]);
            spec.sds = spec.$sync.subscribe('myPub')
                .setSingle(true);
            $rootScope.$digest();
        });

        it('should receive an object without setting the untouched json object', function(done) {
            // For now, For performance purposes, the untouched json object
            // is not generated when incremental option is not enabled.
            spec.sds.waitForDataReady().then(function(data) {
                expect(_.isArray(data)).toBe(false);
                expect(data.timestamp.$untouched).toBeUndefined();
                done();
            });
            $rootScope.$digest();
        });

        it('should update existing record in the array when receiving an update operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.description).toBe(spec.r1.description);
                backend.notifyDataUpdate(subParams, [spec.r1b])
                    .then(function() {
                        expect(data.description).toBe(spec.r1b.description);
                        done();
                    });
            });
            $rootScope.$digest();
        });

        it('should remove a record from array when receiving a removal operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                var p = backend.notifyDataDelete(subParams, [{id: spec.r1.id, revision: spec.r1.revision + 1}]);
                p.then(function() {
                    expect(data.id).toBeUndefined();
                    done();
                });
            });
            $rootScope.$digest();
        });
    });


    describe('Object Array sync', function() {
        beforeEach(function() {
            backend.setData(subParams, [spec.p2, spec.p1]);
            spec.sds = spec.$sync.subscribe('myPub')
                .setObjectClass(Person);
        });

        it('should receive an array of objects with same class', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(_.isArray(data)).toBe(true);
                expect(data[0] instanceof Person).toBe(true);
                expect(data[1] instanceof Person).toBe(true);
                done();
            });
            $rootScope.$digest();
        });

        it('should update existing object in the array when receiving an update operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                var object = _.find(data, {id: spec.p1.id});
                expect(data.length).toBe(2);
                backend.notifyDataUpdate(subParams, [spec.p1b])
                    .then(function() {
                        expect(data.length).toBe(2);
                        expect(object).toBeDefined();
                        expect(object.getFullname()).toBe(spec.p1b.getFullname());
                        done();
                    });
            });
            $rootScope.$digest();
        });

        it('should only update object revision when object synced was originated locally', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                var object = _.find(data, {id: spec.p1.id});
                expect(data.length).toBe(2);

                // modify local version of an object in the array to pretend something was inputed
                object.timestamp = {sessionId: spec.sessionUser.sessionId, $isLocalUpdate: true};
                object.lastname = spec.p1b.lastname;

                expect(object.revision).toBe(1);

                backend.notifyDataUpdate(subParams, [_.assign({}, object, {revision: 2, lastname: 'should never get thru'})])
                    .then(function() {
                        expect(object.lastname).toBe(spec.p1b.lastname);
                        expect(object.timestamp.$isLocalUpdate).toBe(true); // true means the object was updated locally
                        expect(object.revision).toBe(2);
                        done();
                    });
            });
            $rootScope.$digest();
        });
    });

    describe('Single Object sync with incrementals', function() {
        beforeEach(function() {
            backend.setData(subParams, [spec.p1]);
            spec.sds = spec.$sync.subscribe('myPub')
                .enableIncrementalChanges()
                .setSingle(true)
                .setObjectClass(Person);
            $rootScope.$digest();
        });

        it('should receive an object and have set an untouched json object', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.timestamp.$untouched).toEqual({
                    id: 1,
                    firstname: 'Tom',
                    lastname: 'Great',
                    revision: 1,
                });
                done();
            });
            $rootScope.$digest();
        });

        it('should return modifications made to the record', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                // let's modified instance returned by sync
                data.firstname = 'Tommy';
                data.someObjectAdded = {description: 'not part of Person and its ToJSON'};
                // can sync detect the differences?
                const diff = spec.sds.getCurrentModifications();
                expect(diff).toEqual({firstname: 'Tommy'});
                done();
            });
            $rootScope.$digest();
        });
    });


    describe('Single Object sync', function() {
        beforeEach(function() {
            backend.setData(subParams, [spec.p1]);
            spec.sds = spec.$sync.subscribe('myPub')
                .setSingle(true)
                .setObjectClass(Person);
        });

        it('should receive an object', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data instanceof Person).toBe(true);
                done();
            });
            $rootScope.$digest();
        });

        it('should update existing object when receiving an update operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.getFullname()).toBe(spec.p1.getFullname());
                backend.notifyDataUpdate(subParams, [spec.p1b])
                    .then(function() {
                        expect(data.getFullname()).toBe(spec.p1b.getFullname());
                        done();
                    });
            });
            $rootScope.$digest();
        });

        it('should only update object revision when object synced was originated locally', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(data.getFullname()).toBe(spec.p1.getFullname());
                // modify local version to pretend something was inputed
                data.timestamp = {sessionId: spec.sessionUser.sessionId, $isLocalUpdate: true};
                data.lastname = spec.p1b.lastname;

                expect(data.revision).toBe(1);

                backend.notifyDataUpdate(subParams, [_.assign({}, data, {revision: 2, lastname: 'should never get thru'})])
                    .then(function() {
                        expect(data.lastname).toBe(spec.p1b.lastname);
                        expect(data.timestamp.$isLocalUpdate).toBe(true); // true means the object was updated locally
                        expect(data.revision).toBe(2);
                        done();
                    });
            });
            $rootScope.$digest();
        });

        it('should empty the single object  when receiving a removal operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                var p = backend.notifyDataDelete(subParams, [{id: spec.p1.id, revision: spec.p1.revision + 1}]);
                p.then(function() {
                    expect(data.id).toBeUndefined();
                    done();
                });
            });
            $rootScope.$digest();
        });

        it('should NOT empty the object when receiving an OLD removal operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                // debugger;
                backend.notifyDataDelete(subParams, [{id: spec.p1.id, revision: spec.p1.revision}]);
                expect(data.id).toBeDefined();
                done();
            });
            $rootScope.$digest();
        });

        it('should NOT add any object when receiving an OLD removal operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                backend.notifyDataDelete(subParams, [{id: spec.p1.id, revision: spec.p1.revision + 1}])
                    .then(function() {
                        expect(data.id).toBeUndefined();
                        backend.notifyDataDelete(subParams, [{id: spec.p1.id, revision: spec.p1.revision}]);
                        expect(data.id).toBeUndefined();
                        done();
                    });
            });
            $rootScope.$digest();
        });
    });

    describe('Sync Callbacks:', function() {
        describe('onUpdate callback', function() {
            beforeEach(function() {
                backend.setData(subParams, [spec.r1, spec.r2]);
                spec.sds = spec.$sync.subscribe('myPub');
                spec.sds.onUpdate(spec.syncCallbacks.onUpdate);
            });

            it('should NOT get called on receiving data at initialization', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    expect(spec.syncCallbacks.onUpdate).not.toHaveBeenCalled();
                    done();
                });
                $rootScope.$digest();
            });

            it('should get called on receiving updated data', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    backend.notifyDataUpdate(subParams, [spec.r1b])
                        .then(function() {
                            expect(spec.syncCallbacks.onUpdate).toHaveBeenCalled();
                            done();
                        });
                });
                $rootScope.$digest();
            });
        });

        describe('onRemove callback', function() {
            beforeEach(function() {
                backend.setData(subParams, [spec.r1, spec.r2]);
                spec.sds = spec.$sync.subscribe('myPub');
                spec.sds.onRemove(spec.syncCallbacks.onRemove);
            });

            it('should NOT get called on receiving data at initialization', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    expect(spec.syncCallbacks.onRemove).not.toHaveBeenCalled();
                    done();
                });
                $rootScope.$digest();
            });

            it('should get called on receiving data removal', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    var p = backend.notifyDataDelete(subParams, [{id: spec.r1.id, revision: spec.r1.revision + 1}]);
                    p.then(function() {
                        expect(spec.syncCallbacks.onRemove).toHaveBeenCalled();
                        done();
                    });
                });
                $rootScope.$digest();
            });
        });

        describe('onAdd callback', function() {
            beforeEach(function() {
                backend.setData(subParams, [spec.r1, spec.r2]);
                spec.sds = spec.$sync.subscribe('myPub');
                spec.sds.onAdd(spec.syncCallbacks.onAdd);
            });

            it('should ALSO get called on receiving data at initialization', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    expect(spec.syncCallbacks.onAdd).toHaveBeenCalled();
                    done();
                });
                $rootScope.$digest();
            });

            it('should get called on receiving data removal', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    backend.notifyDataUpdate(subParams, [spec.r1b]);
                    expect(spec.syncCallbacks.onAdd).toHaveBeenCalled();
                    done();
                });
                $rootScope.$digest();
            });
        });

        describe('onReady callback', function() {
            beforeEach(function() {
                backend.setData(subParams, [spec.r1]);
                spec.sds = spec.$sync.subscribe('myPub');
                spec.sds.onReady(spec.syncCallbacks.onReady);
            });

            it('should get called on receiving data at initialization', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    expect(spec.syncCallbacks.onReady).toHaveBeenCalled();
                    done();
                });
                $rootScope.$digest();
            });

            it('should get called on receiving new data ', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    backend.notifyDataCreation(subParams, [spec.r2]);
                    expect(spec.syncCallbacks.onReady).toHaveBeenCalled();
                    done();
                });
                $rootScope.$digest();
            });
            it('should get called on receiving data update ', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    backend.notifyDataUpdate(subParams, [spec.r1b]);
                    expect(spec.syncCallbacks.onReady).toHaveBeenCalled();
                    done();
                });
                $rootScope.$digest();
            });
            it('should get called on receiving data removal ', function(done) {
                spec.sds.waitForDataReady().then(function() {
                    backend.notifyDataDelete(subParams, [spec.r1]);
                    expect(spec.syncCallbacks.onReady).toHaveBeenCalled();
                    done();
                });
                $rootScope.$digest();
            });
        });


        describe('setReady callback', function() {
            it('should get called with an array parameter on receiving data at initialization', function(done) {
                backend.setData(subParams, [spec.r1, spec.r2]);
                spec.sds = spec.$sync.subscribe('myPub')
                    .setOnReady(function(data) {
                        expect(_.isArray(data)).toBe(true);
                        done();
                    });
                spec.sds.setParameters();
                $rootScope.$digest();
                //                spec.sds.waitForDataReady();
            });


            it('should get called with an array parameter on receiving data on each sync', function(done) {
                var synchronizedData;
                var n = 2;
                backend.setData(subParams, [spec.r1, spec.r2]);
                spec.sds = spec.$sync.subscribe('myPub')
                    .setOnReady(function(data) {
                        expect(_.isArray(data)).toBe(true);
                        if (!n) {
                            expect(synchronizedData).toBe(data);
                            done();
                        }
                    })
                    .setParameters();
                $rootScope.$digest();
                spec.sds.waitForDataReady().then(function(data) {
                    synchronizedData = data;
                    n--;
                    backend.notifyDataUpdate(subParams, [spec.r3]);
                    n--;
                    backend.notifyDataUpdate(subParams, [spec.r3]);
                });
                $rootScope.$digest();
            });

            it('should get called with an object parameter on receiving data at initialization', function(done) {
                backend.setData(subParams, [spec.p1]);
                spec.sds = spec.$sync.subscribe('myPub')
                    .setSingle(true)
                    .setObjectClass(Person)
                    .setOnReady(function(data) {
                        expect(data instanceof Person).toBe(true);
                        done();
                    })
                    .setParameters();
                $rootScope.$digest();
                spec.sds.waitForDataReady();
                $rootScope.$digest();
            });


            it('should get called with the same object parameter on each sync', function(done) {
                var synchronizedData;
                var n = 1;
                backend.setData(subParams, [spec.p1]);
                spec.sds = spec.$sync.subscribe('myPub')
                    .setSingle(true)
                    .setObjectClass(Person)
                    .setOnReady(function(data) {
                        expect(data instanceof Person).toBe(true);
                        if (!n) {
                            expect(synchronizedData).toBe(data);
                            done();
                        }
                    })
                    .setParameters();
                $rootScope.$digest();
                spec.sds.waitForDataReady().then(function(data) {
                    synchronizedData = data;
                    n--;
                    backend.notifyDataUpdate(subParams, [spec.p1b]);
                });
                $rootScope.$digest();
            });
        });
    });

    describe('Garbage collector', function() {
        beforeEach(function() {
            backend.setData(subParams, [spec.r1, spec.r2]);
            spec.sds = spec.$sync.subscribe('myPub');
        });

        it('should dispose removed record after receiving a removal operation', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                expect(spec.garbageCollector.dispose).not.toHaveBeenCalled();
                var p = backend.notifyDataDelete(subParams, [{id: spec.r2.id, revision: spec.r2.revision + 1}]);
                p.then(function() {
                    expect(spec.garbageCollector.dispose).toHaveBeenCalled();
                    done();
                });
            });
            $rootScope.$digest();
        });

        it('should collect disposed record after some time', function(done) {
            spec.sds.waitForDataReady().then(function(data) {
                var p = backend.notifyDataDelete(subParams, [{id: spec.r2.id, revision: spec.r2.revision + 1}]);
                expect(spec.garbageCollector.run).not.toHaveBeenCalled();
                expect(spec.sds.isExistingStateFor(spec.r2)).toBe(true);
                // this is the time it takes before the spec.garbageCollector runs;
                p.then(function() {
                    jasmine.clock().tick(spec.garbageCollector.getSeconds() * 1000 + 100);
                    expect(spec.garbageCollector.run).toHaveBeenCalled();
                    expect(spec.sds.isExistingStateFor(spec.r2)).toBe(false);
                    done();
                });
            });
            $rootScope.$digest();
        });
    });

    describe('after a network loss', () => {
        beforeEach(() => {
            backend.setData(subParams, [spec.r1, spec.r2]);
            spec.$scope = $rootScope.$new(true);
            spec.sds = spec.$sync.subscribe('myPub', spec.$scope);
            spec.sds.setParameters();
            spec.$scope.$digest();
            jasmine.clock().tick(2100); // the subscription does not listen to connection event right away (Need better handling)
        });

        it('should force a resubscription but get different data after reconnection due to data updated on the backend', function(done) {
            spec.sds.waitForDataReady().then(function() {
                // initial subscription call
                expect(spec.$socketio.fetch.calls.count()).toEqual(1);
                // pretend r1 and r2 are no longer in dataset but instead r3 is 
                // (This situation can happen when data was updated during disconnection on the backend side)
                backend.setData(subParams, [spec.r3]);
                spec.sds.onReady(function() {
                    expect(spec.sds.getData().length).toEqual(1);
                    expect(spec.sds.getData()[0].id).toEqual(3);
                    done();
                });

                expect(spec.sds.getData().length).toEqual(2);

                spec.$scope.$broadcast('user_reconnected');
                expect(spec.$socketio.fetch.calls.count()).toEqual(2);
                // 2nd subscription for reconnect
                expect(spec.$socketio.fetch.calls.mostRecent().args[0]).toEqual('sync.subscribe');
            });
            spec.$scope.$digest();
        });

        it('should force a resubscription and NOT duplicate the data already in the cache', function(done) {
            spec.sds.waitForDataReady().then(function() {
                // initial subscription call
                expect(spec.$socketio.fetch.calls.count()).toEqual(1);
                // pretend r1 is no longer in dataset, but r2 is still present.
                // (This situation can happen when data was updated during disconnection on the backend side)
                backend.setData(subParams, [spec.r2]);
                spec.sds.onReady(function() {
                    expect(spec.sds.getData().length).toEqual(1);
                    expect(spec.sds.getData()[0].id).toEqual(2);
                    done();
                });
                spec.$scope.$broadcast('user_reconnected');
            });
            spec.$scope.$digest();
        });
    });


    it('should force a reject when trying to resolve a subscription takes too much time', function(done) {
        spec.$socketio.network = false;
        spec.$sync.resolveSubscription('myPub', {}, Person).catch(function(err) {
            expect(err).toEqual('SYNC_TIMEOUT');
            done();
        });
        $rootScope.$digest();
        jasmine.clock().tick(spec.$sync.getGracePeriod() * 1000 + 100); // Time is up. The subscription could not be established
        $rootScope.$digest();
    });


    // ////////////////////////////////////////////
    function definePersonClass() {
        function Person(obj) {
            this.firstname = obj.firstname;
            this.lastname = obj.lastname;
            this.id = obj.id;
            this.revision = obj.revision;
            this.getAbbrevation = function() {
                return this.firstname.substring(0, 1) + this.lastname.substring(0, 1);
            };
            this.timestamp = obj.timestamp || {};
        }
        Person.prototype.getFullname = function() {
            return this.firstname + ' ' + this.lastname;
        };
        // this is the object representation that would be communicated thru network or persisted to any support (DB, files...)
        Person.prototype.toJSON = function() {
            return _.pick(this, ['id', 'firstname', 'lastname', 'revision']);
        };
        return Person;
    }
});
