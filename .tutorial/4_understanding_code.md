# Understanding our algorithm

_Hint - expand this pane to make reading the code a little easier for long lines of code._

In this guide, we are given a starting algorithm for our bot. Open the [index.ts](#index.ts)
file, and let's dig into our algorithm! 

**Please note, you can always skip ahead or see the final code within [final_code.ts](#final_code.ts)**

Before reading the code, let's lay out the overall algorithm. This bot that we have
started with has the following rules:
* On spawn, start what we call the "mainLoop"
* While the bot is alive, perform an action every few milliseconds.
* If we have armor, equip the armor
* Then, do one of the following:
  * Attempt to obtain the flag
  * If the bot has the flag, score it
  * If the flag is not available and the bot does not have it, just wait

You'll notice a few other pieces of the code, such as event handlers and other configuration. You can ignore those for now, and come back to them after the tutorial.
For now, you only need to look at the `mainLoop()` function.

Let's go through each part of our code to see how this works:

### The `bot` and `rgctfUtils` objects

The `bot` object is the main object used to control your bot. This object has
functions and properties for commanding your bot to navigate, attack, pick up
objects, and more. The `rgctfUtils` object has functions and properties that
are helpful specifically for the Capture the Flag game mode, such as finding
the flag and scoring the flag in the correct base.

You can see all of their functions and examples at these links:

* rg-bot: https://play.regression.gg/documentation/rg-bot
* rg-ctf-utils: https://github.com/Regression-Games/rg-ctf-utils

### Starting the bot with `spawn`

Within `index.ts`, you will find an event handler that gets called when our bot
spawns into the world.

```typescript
bot.on('spawn', async () => {
  bot.chat(`I have come to win Capture The Flag with my main loop.`)
  await mainLoop()
})
```

This is the piece of code that starts your bot. Once the bot spawns, it will enter
the main loop, and continue to perform that logic until the bot disconnects
or dies.

### Setting up the mainLoop logic

At the start of the `mainLoop` function, you may notice some strange code:

```typescript
const currentMainLoopInstance = mainLoopInstanceTracker

// make sure our loop exits quickly on death/disconnect/kick/etc
const isActiveFunction = () => { return matchInProgress && currentMainLoopInstance === mainLoopInstanceTracker }
while (isActiveFunction()) {
  try {

    // always throttle the runtime first to make sure we don't execute too frequently and waste CPU
    await throttleRunTime(bot)
    ...
```

What this code does is make sure that when our bot dies, our main loop terminates, so that we don't
have multiple main loops running when a new bot spawns. This is tracked by counting the number
of times we've called this mainLoop function. Next, the while loop itself here is where we
run all of our logic. At the very top, a `throttleRunTime(bot)` call makes sure we wait until the next
game tick to perform an action - this ensures that our bot doesn't perform too many actions in
one turn of the game.

### Getting information about our bot

The next part of our main loop is gathering information about the state
of the game. A bunch of code is written here to:

* Figure out our bot's position using `bot.position()
* Find our opponents using `bot.getOpponentUsernames()` and `bot.findEntities()`
* ... and much more!

These values will be used by our bot to make decisions and perform actions, as you'll see in these next sections.

### Performing our first action - equipping armor

We will now perform our first action - equipping our armor! 

This is as simple as calling the Mineflayer armorManager plugin. Mineflayer is
the underlying library we use to communicate to Minecraft, and you can
learn more about it [here](https://mineflayer.prismarine.js.org/#/).

```typescript
bot.mineflayer().armorManager.equipAll()
```

On every turn, we equip any armor that is in our inventory.

### Handling scoring the flag

The first big action the bot tries to take is attempting to score the flag if the
bot has the flag. We call this function in our mainLoop if we have not done
another action so far (which is tracked via the `didSomething` variable):

```typescript
didSomething = await handleScoringFlag(bot, rgctfUtils, opponents, teamMates)
```

Let's go take a look at this function, located in [lib/MainLoopFunctions.ts](#lib/MainLoopFunctions.ts).

```typescript
export async function handleScoringFlag(bot: RGBot, rgctfUtils: RGCTFUtils, opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
    if(rgctfUtils.hasFlag()) {
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
```

This code does the following:
1. If the bot has the flag (`rgctfUtils.hasFlag()`), then perform the next steps
2. Get the bot's team name
3. Based on the team name, choose the correct scoring location for the flag
4. Move towards that position (see [lib/HelperFunctions.ts](#lib/HelperFunctions.ts)) to see more about this function
5. Return true to indicate that we did perform an action this turn (otherwise we return false)

### Handle capturing the flag

We went over scoring the flag first, as it appears first in our bot's logic - this is because when the bot has the flag, we should prioritize doing that first over everything else.

Now, if the bot does not have a flag to score, the next highest priority is to get the flag! We do this with the following code:

```typescript
if (!didSomething) {
  // go pickup the loose flag
  didSomething = await handleCollectingFlag(bot, rgctfUtils, opponents, teamMates)
}
```

Let's take a look at this code.

```typescript
export async function handleCollectingFlag(bot: RGBot, rgctfUtils: RGCTFUtils, opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
    const flagLocation: Vec3 = rgctfUtils.getFlagLocation()
    if (flagLocation) {
        console.log(`Moving toward the flag at ${bot.vecToString(flagLocation)}`)
        //TODO: Do I need to use potions ? un-equip my shield to run faster ?
        await moveTowardPosition(bot, flagLocation, 1)
        return true
    }
    return false
}
```

Here are the steps of what we are doing in that code.

1. Get the location of the flag, which can be `null` if the flag is nowhere to be found
2. If the flag does exist, move towards that flag
3. Return true if we did perform this action, and false otherwise

### Handle the case where we have nothing to do

Finally, the bot has performed actions to help us score points. If none of those actions
could be performed, let's perform some idle action.

```typescript
if (!didSomething) {
  // we had nothing to do ... move towards the middle
  didSomething = await handleBotIdlePosition(bot, rgctfUtils, opponents, teamMates)
}
```

In this case, our idle action will be to move towards the flag spawn. This will allo
us to control part of the map, and grab the flag when it respawns.

```typescript
export async function handleBotIdlePosition(bot: RGBot, rgctfUtils: RGCTFUtils, opponents: Entity[], teamMates: Entity[]): Promise<boolean> {
    // TODO: Is this really the best place to move my bot towards ?
    // Hint: This is where most of Macro game strategy gets implemented
    // Do my bots spread out to key points looking for items or opponents ?
    // Do my bots group up to control key areas of the map ?
    // Do those areas of the map change dependent on where the flag currently is ?
    console.log(`Moving toward center point: ${bot.vecToString(rgctfUtils.FLAG_SPAWN)}`)
    await moveTowardPosition(bot, rgctfUtils.FLAG_SPAWN, 1)
    return true
}
```

### Next steps

Every tick of the game, our bot will equip armor, and then move to either collect the flag, score the flag, or wait near the flag spawn. Save your code and push it to git,
and your bot will instantly reload! Watch it move around and perform those actions.

Let's move on to making our bot a little more complex and robust, as well as implement some
logic that allows our bot to use more of our utilities.