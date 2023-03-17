# Extend our code

Our bot is quite simple right now - repeatedly gets the flag and waits for the flag.
Let's make this ready for a real multiplayer match, by adding logic to:

1. Heal using a potion when at low health
2. Attack the flag carrier if nearby
3. Attack any other opponent that's nearby
4. Place blocks at chokepoints if we have blocks
6. Collect nearby items when waiting for the flag to respawn (see the [Game Specification](https://regressiongg.notion.site/Capture-the-Flag-Game-Specification-bc72be0f38df427287ec428006d1d299) for item info)

**Please note, you can always skip ahead or see the final code within [final_code.ts](#final_code.ts)**

### Add new action calls

First, let's add all of our new functions to our series of priorities in our code.
Underneath the `let didSomething: boolean = false` line of code, copy and paste the
following to replace any existing calls to our bot actions.

```typescript
if (!didSomething) {
  // Check if I'm low on health
  didSomething = await handleLowHealth(bot, rgctfUtils, opponents, teamMates)
}

if (!didSomething) {
  // if someone has the flag, hunt down player with flag if it isn't a team-mate
  didSomething = await handleAttackFlagCarrier(bot, rgctfUtils, opponents, teamMates)
}

if (!didSomething) {
  // do I need to attack a nearby opponent
  didSomething = await handleAttackNearbyOpponent(bot, rgctfUtils, opponents, teamMates)
}

if (!didSomething) {
  // if I have the flag, go score
  didSomething = await handleScoringFlag(bot, rgctfUtils, opponents, teamMates)
}

if (!didSomething) {
  // go pickup the loose flag
  didSomething = await handleCollectingFlag(bot, rgctfUtils, opponents, teamMates)
}

if (!didSomething) {
  // If no-one within N blocks, place blocks
  didSomething = await handlePlacingBlocks(bot, rgctfUtils, opponents, teamMates)
}

if (!didSomething) {
  // see if we can find some items to loot
  didSomething = await handleLootingItems(bot, rgctfUtils, opponents, teamMates)
}

if (!didSomething) {
  // we had nothing to do ... move towards the middle
  didSomething = await handleBotIdlePosition(bot, rgctfUtils, opponents, teamMates)
}
```

### Inspecting the new logic - starting with low health handling

The first piece of new logic we added is handling low health scenarios. Every bot
spawns with a health potion, and we can also pick up various healing and damage
potions as the game progresses.

```typescript
export async function handleLowHealth(bot: RGBot, rgctfUtils: RGCTFUtils, opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
    if (bot.mineflayer().health <= 7) {
        // near death, see if I can use a potion to make the opponent die with me
        const nearOpponent: Entity = opponents.find(them => {
            // within ~4 blocks away
            return them.position.distanceSquared(bot.position()) <= 16
        })
        if (nearOpponent) {
            const potion: Item = getPotionOfType(bot, 'ninja')
            if (potion) {
                // look at their feet before throwing down a ninja potion
                await bot.mineflayer().lookAt(nearOpponent.position.offset(0, -1, 0))
                return await usePotion(bot, potion)
            }
        }
    } else if( bot.mineflayer().health <= 15) {
        // just need a top up
        console.log(`[Health] Need to use potion while my health is low`)
        return await usePotionOfType('health')
    }
    return false
}
```

In this code, the bot:

1. Only apply the following logic if the bot's health is 7 or lower
2. If the bot's health is 7 or lower, and if there is an opponent nearby, throw a
   poison cloud potion (our HelperFunctions file defines these as 'ninja' potions). 
3. Otherwise, if the bot's health is less than or equal to 15, use a healing potion.

This logic allows us to try to kill an enemy if we are almost dead, but heal otherwise.

### Attack a nearby flag carrier

If a nearby enemy has the flag, the bot should prioritize attacking them! We do this
with the `handleAttackFlagCarrier()` helper function.

```typescript
export async function handleAttackFlagCarrier(bot: RGBot, rgctfUtils: RGCTFUtils, opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
    // find out if the flag is available
    const flagLocation: Vec3 = rgctfUtils.getFlagLocation()
    if (!flagLocation) {
        console.log(`Checking ${opponents.length} opponents in range for flag carriers`)
        // see if one of these opponents is holding the flag
        const opponentWithFlag = opponents.filter(them => {
            if (them.heldItem && them.heldItem.name.includes(rgctfUtils.FLAG_SUFFIX)) {
                console.log(`Player ${them.name} is holding the flag`)
                return true
            }
        })?.shift()

        if (opponentWithFlag) {
            console.log(`Attacking flag carrier ${opponentWithFlag.name} at position: ${bot.vecToString(opponentWithFlag.position)}`)
            await usePotionOfType('movement') // run faster to get them
            // TODO: Once I get in range of attack, should I use a combat potion ? should I equip a shield ?
            await bot.attackEntity(opponentWithFlag)
            return true
        }
    }
    return false
}
```

In this code, the bot will:
1. Get the flag location
2. If there is no flag, it looks at nearby opponents, and checks to see if they are
   holding the flag
3. If there is an opponent with the flag, the bot uses a movement potion (if available)
   to go faster, and then attacks that enemy with the `bot.attackEntity()` function.


### Handle any nearby opponent

If there is no bot nearby with the flag, the bot instead focuses on any enemy. 
However, if they are outnumbered, the bot retreats instead.

```typescript
export async function handleAttackNearbyOpponent(bot: RGBot, rgctfUtils: RGCTFUtils, opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
    const outnumbered: boolean = teamMates.length + 1 < opponents.length
    const yolo: boolean = teamMates.length == 0

    const myPosition = bot.position()

    // opportunistically kill any player in close range even if that means dropping the flag to do it
    const theOpponents: Entity[] = opponents.filter(a => {
        // within range 10 regular, 5 if I have the flag
        return a.position.distanceSquared(myPosition) <= (rgctfUtils.hasFlag() ? 25 : 100)
    })

    console.log(`Checking ${theOpponents.length} opponents in range to murder`)
    if (theOpponents.length > 0) {
        const firstOpponent = theOpponents[0]

        //Attack if a teammate is nearby only, otherwise move toward team-mate
        if (!outnumbered || yolo) {
            console.log(`Attacking opponent at position: ${bot.vecToString(firstOpponent.position)}`)
            // TODO: Once I get in range of attack, should I use a combat potion ? should I equip a shield ?
            await bot.attackEntity(firstOpponent)
            return true
        } else {
            console.log(`Outnumbered, running to nearest team-mate for help`)
            //TODO: Do I need to use potions ? un-equip my shield to run faster ?
            await moveTowardPosition(bot, teamMates[0].position, 3)
            return true
        }
    }
    return false
}
```

In this code, the bot is programmed to:

1. Determine if it is outnumbered or by itself.
2. Find nearby enemies. If the bot is carrying the flag, it will still attack, but only
   if the enemy is very close.
3. If the bot is not outnumbered, or if the bot is all alone, go in for an attack.
4. Otherwise, the bot moves toward a teammate

This logic is being smarter than "attack any enemy". Instead, the bot only attacks
if they have no choice, or if they outnumber the opponent. If the bot is near an enemy
and is outnumbered, the bot will go near a teammate for backup!

### Place blocks if any blocks have been collected

As you will see in our next function, the bot may sometimes pick up blocks that it
can place around the map. In the case that we have gravel, dirt, grass, or wood
blocks, let's instruct the bot to blockade parts of the map.

```typescript
export async function handlePlacingBlocks(bot: RGBot, rgctfUtils: RGCTFUtils, opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
    const myPosition = bot.position()
    const myTeamName = bot.getMyTeam()

    const theOpponents = opponents.filter((op) => {
        // only consider bots on the same y plane not those down in the tunnel
        return (Math.abs(op.position.y - myPosition.y) < 5)
    }).filter(a => {
        // only consider opponents within range ~15
        return a.position.distanceSquared(myPosition) <= 225
    })

    console.log(`Checking ${theOpponents.length} opponents in range before getting items or placing blocks`)
    if (theOpponents.length == 0) {

        // If I have blocks to place, go place blocks at strategic locations if they aren't already filled
        const blockInInventory = bot.getAllInventoryItems().find(item => {
            return placeableBlockDisplayNames.includes(item.displayName)
        })

        if (blockInInventory) {
            console.log(`I have a '${blockInInventory.displayName}' block to place`)
            const block_placements = myTeamName == 'BLUE' ? blue_block_placements : red_block_placements
            for (const location of block_placements) {
                // if I'm within 20 blocks of a place to put blocks
                const block = bot.mineflayer().blockAt(location)
                const rangeSq = location.distanceSquared(myPosition)
                console.log(`Checking for block: ${block && block.type} at rangeSq: ${rangeSq}`)
                if (rangeSq <= 400) {
                    if (!block || block.type == 0 /*air*/) {
                        console.log(`Moving to place block '${blockInInventory.displayName}' at: ${location}`)
                        await moveTowardPosition(bot, location, 3)
                        // if I'm close, then place the block
                        if (location.distanceSquared(myPosition) < 15) {
                            console.log(`Placing block '${blockInInventory.displayName}' at: ${location}`)
                            // TODO: RGBot.placeBlock should handle this for us once a defect is fixed
                            await bot.mineflayer().equip(blockInInventory, 'hand')
                            // place block on top face of the block under our target
                            await bot.mineflayer().placeBlock(bot.mineflayer().blockAt(location.offset(0, -1, 0)), new Vec3(0, 1, 0))
                        }
                        return true
                    }
                }
            }
        } else {
            console.log(`No placeable blocks in inventory`)
        }
    }
    return false
}
```

The logic here looks long, but it does the following few steps:

1. Sees how many enemies are nearby, and only does this if no one is nearby
2. Checks to see if it has any blocks in its inventory that it can place
3. If the bot does have placeable block, it tries to find a nearby location where
   it can place a block. These locations that are defined above are parts of the bridge,
   and causes the enemy team bots to walk around the lava pit. It then goes and places
   the block on the face of the desired block (if there is no block already there)

### Loot / collect items that are on the ground

Finally, our last piece of new logic is to collect items that are on the
ground.

```typescript
export async function handleLootingItems(bot: RGBot, rgctfUtils: RGCTFUtils, opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
    const myPosition = bot.position()
    const item: Item = bot.findItemsOnGround({
        maxDistance: 33,
        maxCount: 5,
        // prioritize items I don't have that are the closest
        itemValueFunction: (blockName) => {
            return bot.inventoryContainsItem(blockName) ? 999999 : 1
        },
        sortValueFunction: (distance, pointValue) => {
            return distance * pointValue
        }
    }).filter((theItem: FindResult<Item>) => {
        // @ts-ignore
        // TODO: Should I let my bots run down into the tunnel for better loot ?
        // or keep them on the top only
        return (Math.abs(theItem.result.position.y - myPosition.y) < 5)
    }).map(t => t.result)?.shift()

    if (item) {
        // @ts-ignore
        console.log(`Going to collect item: ${item.name} at: ${bot.vecToString(item.position)}`)
        //TODO: Do I need to use potions ? un-equip my shield to run faster ?

        // @ts-ignore
        await moveTowardPosition(bot, item.position, 1)
        return true
    }
    return false
}
```

This code does the following:

1. Gets the bot's current positition
2. Finds items on the ground using `bot.findItemsOnGround()`. The bot only
   looks up to 33 blocks away, which is their vision range. It assigns a
   low value to blocks that it already has in inventory, and sorts
   the results based on the distance of the block from the bot.
3. The bot then ignores blocks that are not on the same height (i.e. if the
   bot is not in the tunnel, ignore items in the tunnel)
4. Finally, get the item with the best score, and move towards that position.


### Wrapping it all up

Try commiting and pushing this new code using git - your bot will automatically
reload, and you should see it begin to collect items, place blocks, and collect
the flag.
If you get an error, go to your Match Dashboard, click the bot, and click 
"Show Logs" next to your bot name to see what the error might be. At this point,
you can create a disconnect from this practice match, disband your lobby, and
create a new Battle match! Select your bot for all 3 slots of your team, queue
into a match, and see how it compares to other bots! It should now fight the
enemy team as well.