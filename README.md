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

### Example: Syncing a record

### Example: Syncing an object

### Example: Syncing from a view state only or limited scope

### Example: Syncing from a service

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
                   function (person) {
                       return { personId: person.id };
                    },
                    function (friend, person, isDeleted) {
                       if (isDeleted) {
                            person.remove(friend);
                        } else {
                           person.addOrUpdate(friend);
                        }
                    })
                .waitForSubscriptionReady();
         

if you render sds.getData() in your angular app, any change to a person friend (added/deleted/updated) or a person in people will be displayed.


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


### Example: Multi syncing with schema

    sds = $sync.subscribe('people.sync')
           .setSchema(personWithAddressAndFriendsAndEventsWithAttendsSchemaDefinition)
           .setParams(family:'myFamily');

if the schema is defined properly, person object will have all its contents in sync from different syncs


### To improve

Multisync creates a subscription for each record which would lead to performance impact on the back end and front end

- front end could resuse dependent subscription is the setParameters is the same to prevent creating new subscription to the server and release the subscription if no record needs it.Ï
- backend could cache data, so if multiple subscriptions request same data from in a short time there is no access to the db.
Cache size could depends on time (life expectancy or memory size or fixed size)
