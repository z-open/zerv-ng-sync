describe('Multi Sync Service: ', function () {
    var $rootScope, $q;
    var backend;
    var spec;
    var bizSubParams, personSubParams, person3SubParams;
    var syncedData;


    beforeEach(module('sync'));
    beforeEach(module('sync.test'));

    beforeEach(module(function ($provide,
        $syncProvider) {
        $syncProvider.setDebug(2);
    }));


    beforeEach(inject(function (_$rootScope_, mockSyncServer, _$sync_, _$q_, _$syncGarbageCollector_, _$socketio_) {
        $rootScope = _$rootScope_;
        $q = _$q_;

        backend = mockSyncServer;

        var syncCallbacks = {
            onUpdate: function () { },
            onRemove: function () { },
            onAdd: function () { },
            onReady: function () { }
        }

        spec = {
            syncCallbacks: syncCallbacks,
            garbageCollector: _$syncGarbageCollector_,
            $sync: _$sync_,
            $socketio: _$socketio_
        }



        jasmine.clock().install();
        jasmine.clock().mockDate();
    }));

    beforeEach(function setupData() {
        spec.biz1 = new Business({ id: 1, name: 'biz1', revision: 0, managerId: 1 });
        spec.biz1b = new Business({ id: 1, name: 'bizOne', revision: 1, managerId: 2 });
        spec.biz1c = new Business({ id: 1, name: 'bizOne', revision: 2 });
        spec.biz2 = new Business({ id: 2, name: 'biz2', revision: 4 });
        spec.biz3 = new Business({ id: 3, name: 'biz3', revision: 5, managerId: 3 });

        spec.p1 = new Person({ id: 1, firstname: 'Tom', lastname: 'Great', revision: 1 });
        spec.p1b = new Person({ id: 1, firstname: 'Tom', lastname: 'Greater', revision: 2 });
        spec.p2 = new Person({ id: 2, firstname: 'John', lastname: 'Super', revision: 1 });
        spec.p3 = new Person({ id: 3, firstname: 'Mateo', lastname: 'Nexto', revision: 0 });
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


    afterEach(function () {
        jasmine.clock().tick(10000);
        jasmine.clock().uninstall();
    });

    describe('Subscribing to one subscription mapping subscription ', function () {
        beforeEach(function setupSpies() {
            bizSubParams = { publication: 'businesses.pub', params: {} };
            personSubParams = { publication: 'person.pub', params: { id: spec.p1.id } };
            person3SubParams = { publication: 'person.pub', params: { id: spec.p3.id } };
            backend.setArrayData(bizSubParams, [spec.biz1, spec.biz2]);
            backend.setObjectData(personSubParams, spec.p1);

            expect(backend.acknowledge).not.toHaveBeenCalled();
            spec.sds = spec.$sync
                .subscribe('businesses.pub')
                .setObjectClass(Business)
                .mapObjectDs(
                'person.pub',
                { id: 'managerId' },
                function (person, biz) {
                    biz.manager = person;
                },
                { objectClass: Person }
                );
        });

        it('should subscribe and acknowledge to receive inital data', function (done) {

            expect(backend.acknowledge).not.toHaveBeenCalled();
            expect(spec.sds.isSyncing()).toBe(false);
            var promise = spec.sds.waitForDataReady();
            expect(spec.sds.isSyncing()).toBe(true);
            promise.then(function (data) {
                expect(backend.acknowledge).toHaveBeenCalled();
                expect(data.length).toBe(2);
                var biz1 = _.find(data, spec.biz1);
                expect(!!biz1).toBe(true);
                expect(biz1.manager).toBeDefined();
                expect(biz1.manager).toEqual(spec.p1);
                var biz2 = _.find(data, spec.biz2)
                expect(!!biz2).toBe(true);
                expect(biz2.manager).toBeUndefined();
                done();
            });
            $rootScope.$digest();
        });

        describe(', Syncing to add a new object with its dependent ', function () {
            beforeEach(function (done) {
                backend.setObjectData(person3SubParams, spec.p3);

                var promise = spec.sds.waitForDataReady()
                    .then(function (data) {
                        syncedData = data;
                        backend.notifyDataChanges(bizSubParams, [spec.biz3])
                            .then(function () {
                                done();
                            });
                    });
                $rootScope.$digest();
            });

            it('should add a new object', function () {
                expect(syncedData.length).toBe(3);
                var rec = _.find(syncedData, { id: spec.biz3.id });
                expect(rec.name).toBe(spec.biz3.name);
            });

            it('should set the dependent object within the main object', function () {
                var rec = _.find(syncedData, { id: spec.biz3.id });
                expect(rec.manager).toEqual(spec.p3);
            });

            it('should release the main and all dependents subscriptions  on turning sync off', function () {
                expect(backend.unsubscribe).not.toHaveBeenCalled();
                spec.sds.destroy();
                expect(spec.sds.isSyncing()).toBe(false);
                expect(backend.unsubscribe).toHaveBeenCalled();
                expect(backend.unsubscribe.calls.count()).toEqual(3);

                var paramOfFirstCall = backend.unsubscribe.calls.argsFor(0)[0];
                expect(paramOfFirstCall.id).toEqual('sub#1');
                expect(paramOfFirstCall.publication).toEqual(bizSubParams.publication);
                expect(paramOfFirstCall.params).toEqual(bizSubParams.params);

                var paramOfSecondCall = backend.unsubscribe.calls.argsFor(1)[0];
                expect(paramOfSecondCall.id).toEqual('sub#2');
                expect(paramOfSecondCall.publication).toEqual(personSubParams.publication);
                expect(paramOfSecondCall.params).toEqual(personSubParams.params);

                var paramOfSecondCall = backend.unsubscribe.calls.argsFor(2)[0];
                expect(paramOfSecondCall.id).toEqual('sub#3');
                expect(paramOfSecondCall.publication).toEqual(person3SubParams.publication);
                expect(paramOfSecondCall.params).toEqual(person3SubParams.params);

            });
        });
        describe(', Syncing to update an object with its dependent ', function () {

            beforeEach(function (done) {

                var promise = spec.sds.waitForDataReady()
                    .then(function (data) {
                        syncedData = data;
                        backend.notifyDataChanges(bizSubParams, [spec.biz1b])
                            .then(function () {
                                done();
                            });
                    });
                $rootScope.$digest();
            });

            it('should update main object with the field change', function () {
                var rec = _.find(syncedData, { id: spec.biz1.id });
                expect(rec.name).toBe(spec.biz1b.name);
            });

            xit('should update main object with the dependent subscription object change', function () {
                var rec = _.find(syncedData, { id: spec.biz1.id });
                // does not work, because sync does set the params properly to the new value
                expect(rec.manager.firstname).toBe(spec.p3.firstname);
            });

            xit('should update main object with removing the dependent subscription object and release the previous dependent subscription ', function (done) {
                var rec = _.find(syncedData, { id: spec.biz1.id });
                // does not work, because sync does remove the previous sub object
                backend.notifyDataChanges(bizSubParams, [spec.biz1c])
                    .then(function () {
                        expect(rec.manager).toBeUndefined();

                        expect(backend.unsubscribe.calls.count()).toEqual(1);

                        var paramOfSecondCall = backend.unsubscribe.calls.argsFor(0)[0];
                        expect(paramOfSecondCall.id).toEqual('sub#2');
                        expect(paramOfSecondCall.publication).toEqual(personSubParams.publication);
                        expect(paramOfSecondCall.params).toEqual(personSubParams.params);
                        done();
                    });
            });


        });

        it('should sync dependent object with an update and update main object', function (done) {
            var promise = spec.sds.waitForDataReady()
                .then(function (data) {
                    expect(data.length).toBe(2);
                    var rec = _.find(data, { id: spec.biz1.id });
                    backend.notifyDataChanges(personSubParams, [spec.p1b])
                        .then(function () {
                            expect(data.length).toBe(2);
                            expect(rec.manager.firstname).toBe(spec.p1b.firstname);
                            done();
                        });
                });
            $rootScope.$digest();
        });
    });

    //////////////////////////////////////////////

    function Person(obj) {
        this.firstname = obj.firstname;
        this.lastname = obj.lastname;
        this.id = obj.id;
        this.revision = obj.revision;
    }


    function Business(obj) {
        this.name = obj.name;
        this.id = obj.id;
        this.managerId = obj.managerId;
        this.revision = obj.revision;
    }

});
