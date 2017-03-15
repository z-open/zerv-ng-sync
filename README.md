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
setParameters starts the syncing so syncOn is not needed.

### Example: Syncing an object

    promise = $sync.subscribe('people.sync')
                .setObjectClass(Person)
                .waitForDataReady().then(function(data){
                    console.log('subscription is now active and data is ready');
                });
     


The setObjectClass defines the class of each object in the array.
The waitForDataReady starts the syncing. The promise resolves when the initial data is received.

### Example: Syncing from a view state only or limited scope

TBD: using attach(scope)

### Example: Syncing from a service

TBD: No scope, but be aware to release listeners (onUpdate, onReady, onDelete, onAdd) if defined in a state or component.

    
### Example: syncing with simple mapping

Prerequisite:
the publication and notification must be implemented in the zerv-based backend. 

Ex:

    sds = $sync.subscribe('people.sync')
                .setObjectClass(Person)
                .mapData(
                    function (person) {
                         person.city = _.find(cityList,{id:person.cityId});
                    })
                .waitForSubscriptionReady();
         

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
                .waitForSubscriptionReady();
         

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
                .waitForSubscriptionReady();
         

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
                .waitForSubscriptionReady();

if you render sds.getData() in your angular app, any change to a person address or a person in people will be displayed.

Notice here that a function is called to set the personId parameter on the dependent subscription.

### Example: Multi syncing with schema

    sds = $sync.subscribe('people.sync')
           .setSchema(personWithAddressAndFriendsAndEventsWithAttendsSchemaDefinition)
           .setParams(family:'myFamily');

if the schema is defined properly, person object will have all its contents in sync from different syncs.

TODO: provide specifics.

### Unit testing

For service or component involving Syncing, the mockSyncServer can simulate the server side.

    describe('syncTest', function () {

        var $rootScope,$sync,server;
        beforeEach(module('sync'));
        beforeEach(module('sync.test'));

        beforeEach(module(function (
            $syncProvider) {
            $syncProvider.setDebug(1); // to output debug information if needed
        }));

        beforeEach(inject(function (_$rootScope_, _$sync_, _mockSyncServer_) {
        }

        it('should return an array in sync',function(){
            
        })

        it('should add an object to the array',function(){
            
        })
        
        it('should update an array in sync',function(){
            
        })

        it('should remove an object from the array',function(){
            
        })


### Future Enhancements

Multisync creates a subscription for each record which would lead to performance impact on the back end and front end

- front end could resuse dependent subscription is the setParameters is the same to prevent creating new subscription to the server and release the subscription if no record needs it.
- backend could cache data, so if multiple subscriptions request same data from in a short time there is no access to the db.
Cache size could depends on time (life expectancy or memory size or fixed size)

In addition,

- notify creation, update and removals of multiple objects at once (back end change)
- Buffer data notifications on the backend to decrease number of pushes thru the socket 
