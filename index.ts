import {FindResult, RGBot} from "rg-bot"
import RGCTFUtils, {CTFEvent} from 'rg-ctf-utils'
import {Vec3} from "vec3"
import {Item} from "prismarine-item"
import {Entity} from "prismarine-entity"
import {Block} from "prismarine-block"

const armorManager = require("mineflayer-armor-manager")

const {
    getUnbreakableBlockIds,
    nearestTeammates,
    moveTowardPosition,
    throttleRunTime,
    usePotionOfType,
    getPotionOfType,
    usePotion,
    nameForItem
} = require('./lib/HelperFunctions')

/**
 * This capture the flag bot covers most possibilities you could have in a main loop bot.
 * Macro level strategies and tuning are up to you.
 */
export function configureBot(bot: RGBot) {

    // Disable rg-bot debug logging.  You can enable this to see more details about rg-bot api calls
    bot.setDebug(false)

    // Allow parkour so that our bots pathfinding will jump short walls and optimize their path for sprint jumps.
    bot.allowParkour(true)

    // We recommend disabling this on as you can't dig the CTF map.  Turning this on can lead pathfinding to get stuck.
    bot.allowDigWhilePathing(false)

    // Setup the rg-ctf-utils with debug logging
    const rgctfUtils = new RGCTFUtils(bot)
    rgctfUtils.setDebug(true)

    // Load the armor-manager plugin (https://github.com/PrismarineJS/MineflayerArmorManager)
    bot.mineflayer().loadPlugin(armorManager)

    // default to true in-case we miss the start
    let matchInProgress = true

    // Information about the unbreakable block types
    const unbreakable: number[] = getUnbreakableBlockIds(bot)
    console.log(`Unbreakable blocks: ${JSON.stringify(unbreakable)}`)


    // Listeners for key events.  This bot uses these for logging information for debugging.
    // You may use these for actions, but this main loop bot does not
    bot.on('match_ended', async(matchInfo) => {
        const points = matchInfo?.players.find(player => player.username == bot.username())?.metadata?.score
        const captures = matchInfo?.players.find(player => player.username == bot.username())?.metadata?.flagCaptures
        console.log(`The match has ended - I had ${captures} captures and scored ${points} points`)
        matchInProgress = false
    })

    bot.on('match_started', async(matchInfo) => {
        console.log(`The match has started`)
        matchInProgress = true
    })

    bot.on(CTFEvent.FLAG_OBTAINED, async (collector: string) => {
        console.log(`Flag picked up by ${collector}`)
        if (collector == bot.username()) {
            console.log("I have the flag... yippee !!!")
        }
    })

    bot.on(CTFEvent.FLAG_SCORED, async (teamName: string) => {
        console.log(`Flag scored by ${teamName} team`)
    })

    bot.on(CTFEvent.FLAG_AVAILABLE, async (position: Vec3) => {
        console.log("Flag is available")
    })


    // Part of using a main loop is being careful not to leave it running at the wrong time.
    // It is very easy to end up with 2 loops running by accident.
    // Here we track the mainLoop instance count and update on key events.
    let mainLoopInstanceTracker = 0

    bot.on('playerLeft', (player) => {
        if(player.username == bot.username()) {
            console.log(`!*!*!*! I have left.. uh oh...`)
            ++mainLoopInstanceTracker
        }
    })

    bot.on('end', () => {
        console.log(`!*!*!*! I have disconnected...`)
        ++mainLoopInstanceTracker
    })

    bot.on('kicked', () => {
        console.log(`!*!*!*! I have been kicked...`)
        ++mainLoopInstanceTracker
    })

    bot.on('death', () => {
        console.log("!*!*!*! I have died...")
        ++mainLoopInstanceTracker
        try {
            // stop any current goal
            // @ts-ignore
            bot.mineflayer().pathfinder.setGoal(null)
            // @ts-ignore
            bot.mineflayer().pathfinder.stop()
        } catch (ex) {

        }
    })


    // You could write all the code inside this spawn listener, but we separate it out into its own mainLoop function
    bot.on('spawn', async () => {
        bot.chat(`I have come to win Capture The Flag with my main loop.`)
        await mainLoop()
    })

    async function handleLowHealth(opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
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

    async function handleAttackFlagCarrier(opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
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
                await usePotionOfType('flag_carrier') // run faster to get them
                // TODO: Once I get in range of attack, should I use a combat potion ? should I equip a shield ?
                await bot.attackEntity(opponentWithFlag)
                return true
            }
        }
        return false
    }

    async function handleAttackNearbyOpponent(opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
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

    async function handleScoringFlag(opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
        if( rgctfUtils.hasFlag()) {
            //TODO: Do I need to use potions ? un-equip my shield to run faster ?
            console.log(`I have the flag, running to score`)
            const myTeamName = bot.getMyTeam()
            const myScoreLocation: Vec3 =
                myTeamName == 'BLUE' ? rgctfUtils.BLUE_SCORE_LOCATION : rgctfUtils.RED_SCORE_LOCATION
            await moveTowardPosition(bot, myScoreLocation, 1)
            return true
        }
        return false
    }

    async function handleCollectingFlag(opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
        const flagLocation: Vec3 = rgctfUtils.getFlagLocation()
        if (flagLocation) {
            console.log(`Moving toward the flag at ${bot.vecToString(flagLocation)}`)
            //TODO: Do I need to use potions ? un-equip my shield to run faster ?
            await moveTowardPosition(bot, flagLocation, 1)
            return true
        }
        return false
    }

    const placeableBlockDisplayNames = ['Gravel', 'Grass Block', 'Dirt', 'Stripped Dark Oak Wood']

    const blue_block_placements = [
        // bridge blockade
        new Vec3(81,65,-387), new Vec3(81, 66, -387), new Vec3(81,65,-385), new Vec3(81, 66, -385)
    ]

    const red_block_placements = [
        // bridge blockade
        new Vec3(111,65,-387), new Vec3(111, 66, -387), new Vec3(111,65,-385), new Vec3(111, 66, -385)

    ]

    async function handlePlacingBlocks(opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
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
                const block_placements = myTeamName == "BLUE" ? blue_block_placements : red_block_placements
                for (const location of block_placements) {
                    // if I'm within 15 blocks of a place to put blocks
                    const block = bot.mineflayer().blockAt(location)
                    const rangeSq = location.distanceSquared(myPosition)
                    console.log(`Checking for block: ${block && block.type} at rangeSq: ${rangeSq}`)
                    if (rangeSq <= 225) {
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

    async function handleLootingItems(opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
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

    async function handleBotIdlePosition(opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
        // TODO: Is this really the best place to move my bot towards ?
        // Hint: This is where most of Macro game strategy gets implemented
        // Do my bots spread out to key points looking for items or opponents ?
        // Do my bots group up to control key areas of the map ?
        // Do those areas of the map change dependent on where the flag currently is ?
        console.log(`Moving toward center point: ${bot.vecToString(rgctfUtils.FLAG_SPAWN)}`)
        await moveTowardPosition(bot, rgctfUtils.FLAG_SPAWN, 1)
        return true
    }


    async function mainLoop() {
        const currentMainLoopInstance = mainLoopInstanceTracker

        // make sure our loop exits quickly on death/disconnect/kick/etc
        const isActiveFunction = () => {return matchInProgress && currentMainLoopInstance===mainLoopInstanceTracker}
        while (isActiveFunction()) {
            try {

                // always throttle the runtime first to make sure we don't execute too frequently and waste CPU
                await throttleRunTime(bot)

                // find out which team I'm on
                const myTeamName: string = bot.getMyTeam()
                const otherTeamName: string = bot.matchInfo().teams.find(t => t.name != myTeamName)?.name

                // get my current position and log information about my state
                const myPosition: Vec3 = bot.position()
                console.log(`My team: ${myTeamName}, my position: ${bot.vecToString(myPosition)}, my inventory: ${JSON.stringify(bot.getAllInventoryItems().map((item) => nameForItem(bot, item)))}`)

                // find any opponents in range
                const opNames: string[] = bot.matchInfo().players.filter(player => player.team != myTeamName).map(p => p.username)
                const opponents: Entity[] = bot.findEntities({
                    // opNames can be empty in practice mode where there is no other team
                    // if we don't pass some array to match, then this will return all entities instead
                    entityNames: (opNames.length == 0 && ['...']) || opNames,
                    attackable: true,
                    maxCount: 3,
                    maxDistance: 33, // Bots can only see ~30 +/1 blocks, so no need to search far
                    entityValueFunction: (entityName) => {
                        return 0
                    },
                    // just sort them by distance for now... We'll filter them by decision point later
                    sortValueFunction: (distance, pointValue, health = 0, defense = 0, toughness = 0) => {
                        return distance
                    }
                }).map(fr => fr.result)

                // find any teammates in range
                const teamMates: Entity[] = nearestTeammates(bot, 33, true)



                // equip my best armor
                bot.mineflayer().armorManager.equipAll()



                // Only take 1 action per main loop pass.  There are exceptions, but this is best practice as the
                // game server can only process so many actions per tick
                let didSomething: boolean = false


                if (!didSomething) {
                    // Check if I'm low on health
                    didSomething = await handleLowHealth(opponents, teamMates)
                }

                if(!didSomething ) {
                    // if someone has the flag, hunt down player with flag if it isn't a team-mate
                    didSomething = await handleAttackFlagCarrier(opponents, teamMates)
                }

                if(!didSomething) {
                    // do I need to attack a nearby opponent
                    didSomething = await handleAttackNearbyOpponent(opponents, teamMates)
                }

                if(!didSomething) {
                    // if I have the flag, go score
                    didSomething = await handleScoringFlag(opponents, teamMates)
                }

                if (!didSomething) {
                    // go pickup the loose flag
                    didSomething = await handleCollectingFlag(opponents, teamMates)
                }

                if (!didSomething) {
                    // If no-one within N blocks, place blocks
                    didSomething = await handlePlacingBlocks(opponents, teamMates)
                }


                if( !didSomething) {
                    // see if we can find some items to loot
                    didSomething = await handleLootingItems(opponents, teamMates)
                }

               if(!didSomething) {
                    // we had nothing to do ... move towards the middle
                    didSomething = await handleBotIdlePosition(opponents, teamMates)
                }

            } catch (ex) {
                // if we get anything other than a pathfinding change error, log it so that we can fix our bot
                if (!(ex.toString().includes("GoalChanged") || ex.toString().includes("PathStopped"))) {
                    console.warn(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`)
                    console.warn(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`)
                    console.warn(`Error during bot execution`, ex)
                    console.warn(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`)
                    console.warn(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`)
                    await bot.wait(20) // wait 1 seconds before looping again to avoid tight loops on errors
                }
            }
        }
        console.log('BOT Loop End...')
    }

}