### Use Case
Angular Service that allows an array of data or object remain in sync with backend.
If network is lost, the service will handle recovering the missing data.

Client (angular app) subscribes to a publication defined on the server.
The subscription returns an array or object instance that remains in sync.

### Pre-Requisite:
The backend must run the zerv-sync middleware, which is a feature of the zerv middleware.

Publications to subscribe to are defined on the server.
 
When the backend writes any data to the db that are supposed to be synchronized:
* It must make sure each add, update, removal of record is timestamped (or increased a revision number)
* It must notify the changes to all publications (with notifyChange or notifyRemoval) with some params so that backend knows that it has to push back the data back to the subscribers/

Sync does not work if objects do not have BOTH id and revision field!!!!

### Example: Syncing an array

    sds = $sync
          .subscribe('people.sync')
          .syncOn();
    data = sds.getData();
           
    $scope.$watchCollection(data,function() {
        console.log(data);
    }) 

The data contains an array whose items remains in sync.
SyncOn starts the syncing.


### Example: Syncing a record

    sds = $sync
          .subscribe('person.sync')
          .setSingle(true)
          .setParameters({id:20});
    data = sds.getData();
            
The data contains an object that remains in sync.
SetParameters defines the parameters that the publication expects.

setParameters starts the syncing, so syncOn is not needed.

### Example: Syncing an object

    promise = $sync.subscribe('people.sync')
                .setObjectClass(Person)
                .waitForDataReady().then(function(data){
                    console.log('subscription is now active and data is ready');
                });
     


The setObjectClass defines the class of each object in the array.
The waitForDataReady starts the syncing. The promise resolves when the initial data is received.

### Example: start or stop syncing

There are multiple ways for a subscription to start syncing
- setParameters(object): Provide the parameters and the subscription will start syncing
- waitForDataReady(): the subscription will start syncing if it is not already syncing. This returns a promise resolving with the data
- syncOn(): the subscription will start syncing if it is not already syncing

In order to stop a subscription
- syncOff(): this will stop the subscription and release resources on the server
- destroy(): This will also destroy the subscription.
- attach($scope): This will destroy the subscription when the scope is destroyed.

Ex:

     sds = $sync.subscribe('people.sync')
           .setOnReady(
     
     // sds starts syncing after waitForDataReady since no setParameters was provided.
     sds.waitForDataReady().then(function(data){
          console.log('subscription is now initialed with data.');
     });
     
     // 10s later it stops
     setTimeout(function() {
          sds.syncOff();
      
     }, 10000);
     
     // 20s later it restarts
     setTimeout(function() {
          sds.syncOn();
     }, 20000);
    
    

### Example: Syncing from a view state only or limited scope

TBD: using attach(scope)

### Example: Syncing from a service

TBD: No scope, but be aware to release listeners (onUpdate, onReady, onDelete, onAdd) if defined in a state or component.
    
    
### Example: listeners 

There are 4 listeners that can be set up: 
- onReady:   Each time the data is ready
- onUpdate:  Each time a single record is updated
- onRemove:  Each time a single record is removed
- onAdd: Each time a record is added.

Ex: 
to set up a function to be called when data is ready (each time data is received)



    off = sds.onReady(function(arrayOrObject) {
          console.log(arrayOrObject);
    });
    
    
    
to remove the listener

    off()
    
    
Ex: 
to set up a function to be called when data is removed



    off = sds.onRemove(function(object) {
          console.log('Removed object '+ object.id);
    });
    
and to remove the listener


    off()
    
 
    
 
### Example: syncing with simple mapping

Prerequisite:
the publication and notification must be implemented in the zerv-based backend. 

Ex:

    sds = $sync.subscribe('people.sync')
                .setObjectClass(Person)
                .mapData(
                    function (person) {
                         person.city = _.find(cityList,{id:person.cityId});
                    });
    // the following starts the subscription since setParameters was not provided
    sds.syncOn();
         

In the above example, each time a person is synced (updated or added), the city object will be looked up in an array (using lodash).


Ex:

    sds = $sync.subscribe('people.sync')
                .setObjectClass(Person)
                .mapData(
                    function (person) {
                         person.city = _.find(cityList,{id:person.cityId});

                         return myRestService.fetchFriends(person.id).then(                             
                             function(friends) {
                                person.setFriends(friends);
                             }
                         ) 
                    })
                 .syncOn();
    
         

In the above example, each time a person is synced (updated or added), myRestService.fetchFriends will also be called. There is no sync on friends data since it is not a subscription.
if the rest call fails, the map and sync will fail. 


### Example: Multi syncing

Prerequisite:
the publication and notification must be implemented in the zerv-based backend. 

Ex:

    sds = $sync.subscribe('people.sync')
                .setObjectClass(Person)
                .mapArrayDs('people.friends.sync',
                    { personId: 'id' },
                    function (friend, person, isDeleted) {
                       if (isDeleted) {
                            person.remove(friend);
                        } else {
                           person.addOrUpdate(friend);
                        }
                    })
                 .syncOn();
         

if you render sds.getData() in your angular app, any change to a person friend (added/deleted/updated) or a person in people will be displayed.

Notice that that the 'id' value comes from each person record to set the personId parameter on the dependent subscription.


Ex:

    sds = $sync.subscribe('people.sync')
               .setObjectClass(Person)
                .mapObjectDs('people.address.sync',
                  function (person) {
                        return { personId: person.id };
                    },
                    // for each resource received via sync, this map function is executed
                    function (address, person) {
                        person.address = address;
                    })
                .syncOn();

if you render sds.getData() in your angular app, any change to a person address or a person in people will be displayed.

Notice here that a function is called to set the personId parameter on the dependent subscription.


### Unit testing

For service or component involving Syncing, the mockSyncServer can simulate the server side.
This service is available in the sync.test module. This module is provide in dist/zerv-ng-sync-mock.js.
The library must be set up in your test runner beforehand in addition of dist/zerv-ng-sync.js library.

    describe('syncTest', function () {

        var $rootScope,$sync,backend,spec;
        beforeEach(module('sync.test'));

        beforeEach(module(function (
            $syncProvider) {
            $syncProvider.setDebug(1); // to output debug information if needed
        }));

        beforeEach(inject(function (_$rootScope_, _$sync_, _mockSyncServer_) {
            backend = _mockSyncServer_;
            $rootScope = _$rootScope_;
        }
        
        beforeEach(function setupData() {
            spec.r1 = { id: 1, description: 'person1', revision: 0 };
            spec.r1b = { id: 1, description: 'personOne', revision: 1 };
            spec.r2 = { id: 2, description: 'person2', revision: 4 };
            spec.r3 = { id: 3, description: 'person3', revision: 5 };
            spec.subParams = { publication: 'myPub', params: {} };

            backend.publishArray(spec.subParams, [spec.r1,spec.r2]);
            spec.sds = spec.$sync.subscribe('myPub').setParams({});
            // Calling digest will run the syncing process to get the data from the backend.
            $rootScope.$digest();
        });

        it('should have the data received',function(done){  
                   expect(sds.getData().length).toBe(2);
        })

        it('should return an array via the resolved promise',function(done){
               spec.sds.waitForDataReady(function(data){
                   expect(sds.getData().length).toBe(2);
                   done();
               });
        })

        it('should add an object to the array',function(){
            backend.notifyDataCreation(spec.subParams, [spec.r3]);
            expect(spec.sds.getData().length).toBe(3);
        })
        
        it('should update an array in sync',function(){
            backend.notifyDataUpdate(spec.subParams, [spec.r1b]);
            expect(spec.sds.getData()[0].description).toBe(spec.r1b.description);
        })

        it('should remove an object from the array',function(){
            spec.r1.revision++;
            backend.notifyDataDelete(spec.subParams, [spec.r1]);
            expect(spec.sds.getData().length).toBe(1);
        })

        it('should remove the subscription to the server on subscription destruction',function(){
            expect(backend.exists(spec.subParams).toBe(true);
            spec.sds.destroy();
            expect(backend.exists(spec.subParams).toBe(false);
        })

        it('should provide the number of active subscriptions on the front end',function(){
            expect($sync.getCurrentSubscriptionCount()).toBe(1);
        })
    });

    The notify functions do run internally a digest cycle.


