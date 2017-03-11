describe('Multi Sync Service: ', function () {
    var $rootScope, $q;
    var backend;
    var spec;


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
        spec.biz1 = new Business({ id: 1, description: 'biz1', revision: 0, managerId: '1' });
        spec.biz1b = new Business({ id: 1, description: 'bizOne', revision: 1 });
        spec.biz2 = new Business({ id: 2, description: 'biz2', revision: 4 });
        spec.biz3 = new Business({ id: 3, description: 'biz3', revision: 5 });
        spec.recordWithNoRevision = { id: 44, description: 'biz44' };

        spec.person1 = { id: { id1: 1, id2: 1 }, description: 'person1', revision: 0 };
        spec.person1b = { id: { id1: 1, id2: 1 }, description: 'personOne', revision: 1 };
        spec.person2 = { id: { id1: 2, id2: 1 }, description: 'person2', revision: 4 };
        spec.person3 = { id: { id1: 3, id2: 1 }, description: 'person3', revision: 5 };


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



    it('should subscribe and acknowledge to receive inital data', function (done) {
        var bizSubParams = { publication: 'businesses.pub',params:{} };
        var personSubParams = { publication: 'person.pub',params:{id:'1'} };
        backend.setArrayData([spec.biz1, spec.biz2], bizSubParams);
        backend.setObjectData(spec.p1, personSubParams);

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

          //  expect(_.isEqual(biz1.manager, spec.p1)).toBe(true);

            expect(!!_.find(data, spec.biz2)).toBe(true);
            done();
        });
        $rootScope.$digest();
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
