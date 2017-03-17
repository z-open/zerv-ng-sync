describe('Multi Sync Service: ', function () {
    var $rootScope, $q;
    var backend;
    var spec;
    var bizSubParams, personSubParams, person2SubParams, person3SubParams;
    var syncedData;


    beforeEach(module('sync'));
    beforeEach(module('sync.test'));

    beforeEach(module(function ($provide,
        $syncProvider, $socketioProvider, mockSyncServerProvider) {
        $syncProvider.setDebug(2);
        mockSyncServerProvider.setDebug(true);
        $socketioProvider.setDebug(true);
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
        spec.biz2b = new Business({ id: 2, name: 'biz2', revision: 5, managerId: 2 });
        spec.biz3 = new Business({ id: 3, name: 'biz3', revision: 3, managerId: 3 });

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
            person2SubParams = { publication: 'person.pub', params: { id: spec.p2.id } };
            person3SubParams = { publication: 'person.pub', params: { id: spec.p3.id } };
            backend.publishArray(bizSubParams, [spec.biz1, spec.biz2]);
            backend.publishObject(personSubParams, spec.p1);
            backend.publishObject(person2SubParams, spec.p2);

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
            syncedData = spec.sds.getData();
        });
        it('should not subscribe before sync is on', function () {
            expect(backend.acknowledge).not.toHaveBeenCalled();
            expect(spec.sds.isSyncing()).toBe(false);
            $rootScope.$digest();
        });

        describe(', Syncing initialization', function () {
            beforeEach(function () {
                spec.sds.syncOn();
                $rootScope.$digest();
            });

            it('should create subscription in the backend ', function () {
                expect(backend.exists(bizSubParams)).toBe(true);
                expect(backend.exists(personSubParams)).toBe(true);
            });

            it('should subscribe and receive inital data', function () {
                expect(syncedData.length).toBe(2);
            });

            it('should unsubscribe when subscription is destroyed', function () {
                spec.sds.destroy();
                expect(backend.exists(bizSubParams)).toBe(false);
                expect(backend.exists(personSubParams)).toBe(false);
            });

            xit('should unsubscribe when subscription is off', function () {
                spec.sds.syncOff();
                expect(backend.exists(bizSubParams)).toBe(false);
                // should have released when it is the main subscription.....!!!!
                expect(backend.exists(personSubParams)).toBe(false);
            });

            it('should subscribe and acknowledge to receive inital data', function () {
                expect(spec.sds.isSyncing()).toBe(true);
                expect(backend.acknowledge).toHaveBeenCalled();
            });

            it('should map secondary objects to the main ones', function () {
                var biz1 = _.find(syncedData, spec.biz1);
                expect(!!biz1).toBe(true);
                expect(biz1.manager).toBeDefined();
                expect(biz1.manager).toEqual(spec.p1);
                var biz2 = _.find(syncedData, spec.biz2)
                expect(!!biz2).toBe(true);
                expect(biz2.manager).toBeUndefined();
            });
        });

        describe(', Syncing to delete an object with its dependent ', function () {
            beforeEach(function () {
                spec.sds.syncOn();
                $rootScope.$digest();
                spec.biz1.revision++;
                backend.notifyDataDelete(bizSubParams, [spec.biz1]);
            });

            it('should delete  object', function () {
                expect(syncedData.length).toBe(1);
            });

            it('should aloa remove its object dependent subscriptions', function () {
                expect(backend.exists(personSubParams)).toBe(false);
            });

            it('should keep the main subscription on', function () {
                expect(backend.exists(bizSubParams)).toBe(true);
            });
        });

        describe(', Syncing to add a new object with its dependent ', function () {
            beforeEach(function () {
                backend.publishObject(person3SubParams, spec.p3);
                spec.sds.syncOn();
                $rootScope.$digest();
                backend.notifyDataCreation(bizSubParams, [spec.biz3]);
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

            beforeEach(function () {
                spec.sds.syncOn();
                $rootScope.$digest();
            });

            it('should update main object with the field change', function () {
                backend.notifyDataUpdate(bizSubParams, [spec.biz1b]);
                var rec = _.find(syncedData, { id: spec.biz1.id });
                expect(rec.name).toBe(spec.biz1b.name);
            });

            it('should update main object with the dependent subscription object change', function () {
                backend.notifyDataUpdate(bizSubParams, [spec.biz1b]);
                var rec = _.find(syncedData, { id: spec.biz1.id });
                expect(rec.manager.firstname).toBe(spec.p2.firstname);
            });

            it('should update main object with the new dependent subscription object', function () {
                backend.notifyDataUpdate(bizSubParams, [spec.biz2b]);
                var rec = _.find(syncedData, { id: spec.biz2.id });
                expect(rec.manager).toBeDefined();
                expect(rec.manager.firstname).toBe(spec.p2.firstname);
            });

            it('should update main object with removing the dependent subscription object and release the previous dependent subscription ', function () {
                backend.notifyDataUpdate(bizSubParams, [spec.biz1c]);
                var rec = _.find(syncedData, { id: spec.biz1.id });
                expect(rec.manager).toBeUndefined();
                // the subscription to the person who was a manager is no longer needed. Subscription is no longer needed on the backend.
                expect(backend.unsubscribe.calls.count()).toEqual(1);

                var paramOfSecondCall = backend.unsubscribe.calls.argsFor(0)[0];
                expect(paramOfSecondCall.id).toEqual('sub#2');
                expect(paramOfSecondCall.publication).toEqual(personSubParams.publication);
                expect(paramOfSecondCall.params).toEqual(personSubParams.params);
                //  });
            });


        });

        it('should update dependent object and update main object', function () {
            var promise = spec.sds.syncOn();
            $rootScope.$digest();
            expect(syncedData.length).toBe(2);
            var rec = _.find(syncedData, { id: spec.biz1.id });
            backend.notifyDataUpdate(personSubParams, [spec.p1b])
                .then(function () {
                    expect(syncedData.length).toBe(2);
                    expect(rec.manager.firstname).toBe(spec.p1b.firstname);

                });
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
