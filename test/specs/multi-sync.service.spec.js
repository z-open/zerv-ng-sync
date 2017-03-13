describe('Multi Sync Service: ', function () {
    var $rootScope, $q;
    var backend;
    var spec;
    var bizSubParams, personSubParams;


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
        spec.biz1 = new Business({ id: 1, name: 'biz1', revision: 0, managerId: '1' });
        spec.biz1b = new Business({ id: 1, name: 'bizOne', revision: 1 });
        spec.biz2 = new Business({ id: 2, name: 'biz2', revision: 4 });
        spec.biz3 = new Business({ id: 3, name: 'biz3', revision: 5 });
        spec.recordWithNoRevision = { id: 44, name: 'biz44' };

        spec.person1 = { id: { id1: 1, id2: 1 }, name: 'person1', revision: 0 };
        spec.person1b = { id: { id1: 1, id2: 1 }, name: 'personOne', revision: 1 };
        spec.person2 = { id: { id1: 2, id2: 1 }, name: 'person2', revision: 4 };
        spec.person3 = { id: { id1: 3, id2: 1 }, name: 'person3', revision: 5 };


        Person = definePersonClass();
        spec.p1 = new Person({ id: 1, firstname: 'Tom', lastname: 'Great', revision: 1 });
        spec.p1b = new Person({ id: 1, firstname: 'Tom', lastname: 'Greater', revision: 2 });
        spec.p2 = new Person({ id: 2, firstname: 'John', lastname: 'Super', revision: 1 });
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
            personSubParams = { publication: 'person.pub', params: { id: '1' } };
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

        it('should sync main object with an update', function (done) {

            var promise = spec.sds.waitForDataReady()
                .then(function (data) {
                    expect(data.length).toBe(2);
                    var rec = _.find(data, { id: spec.biz1.id });
                    backend.notifyDataChanges(bizSubParams, [spec.biz1b])
                        .then(function () {
                            expect(data.length).toBe(2);
                            expect(rec.name).toBe(spec.biz1b.name);
                            done();
                        });
                });
            $rootScope.$digest();
        });

    });

    //////////////////////////////////////////////
    function definePersonClass() {
        function Person(obj) {
            this.firstname = obj.firstname;
            this.lastname = obj.lastname;
            this.id = obj.id;
            this.revision = obj.revision;
        }
        Person.prototype.getFullname = function () {
            return this.firstname + ' ' + this.lastname;
        }
        return Person;
    }

    function Business(obj) {
        this.name = obj.name;
        this.id = obj.id;
        this.managerId = obj.managerId;
        this.revision = obj.revision;
    }

});
