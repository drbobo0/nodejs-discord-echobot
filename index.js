const Discord = require('discord.js'); //import client from discord
const keep_alive = require('./keep_alive.js')

const client = new Discord.Client();

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});
// emoji that goes in the post title
const tt = '⭐'
let settings
let guildID = ''
let smugboardID = ''
let messagePosted = {}
let loading = true

try {
  settings = require('./settings.json')
} catch (e) {
  console.log(`a settings.json file has not been generated. ${e.stack}`)
  process.exit()
}
// load old messages into memory
async function loadIntoMemory () {
  const channel = client.guilds.cache.get(guildID).channels.cache.get(smugboardID)
  let limit = settings.fetchLimit
  console.log(`Loading ${limit} messages...`)

  let messagesLeft = 0
  if (limit > 100) {
    messagesLeft = limit - 100
    limit = 100
  }

  console.log(`${messagesLeft} messages left to load`)
  var messages = await channel.messages.fetch({ limit: limit })

  while (messagesLeft) {
    if (messagesLeft > 100) {
      messagesLeft = messagesLeft - 100
      console.log(`${messagesLeft} messages left to load`)
      const moreMessages = await channel.messages.fetch({ limit: 100, before: messages.lastKey() })
      messages = await messages.concat(moreMessages)
    } else {
      console.log(`${messagesLeft} messages left to load`)
      const moreMessages = await channel.messages.fetch({ limit: messagesLeft, before: messages.lastKey() })
      messages = await messages.concat(moreMessages)
      messagesLeft = 0
    }
  }

  const posts = messages.filter(m => m.content.match(/\((\d{18})\)/))
  const newPosts = messages.filter(m => {
    if (m.embeds.length > 0) {
      if (m.embeds[0].footer) { return String(m.embeds[0].footer.text).match(/\((\d{18})\)/) } else { return false }
    } else {
      return false
    }
  })

  const postsMap = posts.reduce((mapAccumulator, obj) => {
    // either one of the following syntax works
    // mapAccumulator[obj.key] = obj.val;
    mapAccumulator[String(obj.content.match(/\((\d{18})\)/)[1])] = {
      p: true,
      lc: settings.threshold + 1,
      legacy: true,
      psm: obj.id
    }

    return mapAccumulator
  }, {})

  const newPostsMap = newPosts.reduce((mapAccumulator, obj) => {
    // either one of the following syntax works
    // mapAccumulator[obj.key] = obj.val;
    mapAccumulator[String(obj.embeds[0].footer.text).match(/\((\d{18})\)/)[1]] = {
      p: true,
      lc: settings.threshold + 1,
      legacy: false,
      psm: obj.id
    }

    return mapAccumulator
  }, {})

  messagePosted = { ...postsMap, ...newPostsMap }

  console.log(`Loaded ${Object.keys(postsMap).length} legacy posts, and ${Object.keys(newPostsMap).length} new posts in ${settings.reactionEmoji} channel`)

  console.log('Loading complete')
  loading = false
}

// manage the message board on reaction add/remove
function manageBoard (reaction_orig) {

  const msg = reaction_orig.message
  const msgChannel = client.guilds.cache.get(guildID).channels.cache.get(msg.channel.id)
  const msgLink = `https://discordapp.com/channels/${guildID}/${msg.channel.id}/${msg.id}`
  const postChannel = client.guilds.cache.get(guildID).channels.cache.get(smugboardID)

  msgChannel.messages.fetch(msg.id).then((msg) => {
    // if message is older than set amount
    const dateDiff = (new Date()) - reaction_orig.message.createdAt
    const dateCutoff = 1000 * 60 * 60 * 24
    if (Math.floor(dateDiff / dateCutoff) >= settings.dateCutoff) {
      console.log(`a message older than ${settings.dateCutoff} days was reacted to, ignoring`)
      return
    }

    // We need to do this because the reaction count seems to be 1 if an old cached
    // message is starred. This is to get the 'actual' count
    let found = false
    msg.reactions.cache.forEach((reaction) => {
      if (reaction.emoji.name == settings.reactionEmoji) {
        found = true
        console.log(`message ${settings.reactionEmoji}'d! (${msg.id}) in #${msgChannel.name} total: ${reaction.count}`)
        // did message reach threshold
        if (reaction.count >= settings.threshold) {
          messagePosted[msg.id].lc = reaction.count
          // if message is already posted
          if (messagePosted[msg.id].hasOwnProperty('psm')) {
            const editableMessageID = messagePosted[msg.id].psm
            console.log(`updating count of message with ID ${editableMessageID}. reaction count: ${reaction.count}`)
            const messageFooter = `${reaction.count} ${tt} (${msg.id})`
            postChannel.messages.fetch(editableMessageID).then((message) => {
              message.embeds[0].setFooter(messageFooter)
              message.edit(message.embeds[0])
            })
          } else {
            // if message has already been created
            if (messagePosted[msg.id].p) return

            console.log(`posting message with content ID ${msg.id}. reaction count: ${reaction.count}`)
            // add message to ongoing object in memory
            messagePosted[msg.id].p = true

            // create content message
            const contentMsg = `${msg.content}\n\n **Go to Message \n [Jump
            ](${msgLink}) **`

            //Go to Message const contentMsg = `${msg.content}\n\n→ [original message](${msgLink}) in <#${msg.channel.id}>`

            const avatarURL = `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.jpg`
            const embeds = msg.embeds
            const attachments = msg.attachments
            const messageFooter = `${reaction.count} ${tt} (${msg.id})`
            let eURL = ''

            if (embeds.length > 0) {
              // attempt to resolve image url; if none exist, ignore it
              if (embeds[0].thumbnail && embeds[0].thumbnail.url) { eURL = embeds[0].thumbnail.url } else if (embeds[0].image && embeds[0].image.url) { eURL = embeds[0].image.url } else { eURL = embeds[0].url }
            } else if (attachments.array().length > 0) {
              const attARR = attachments.array()
              eURL = attARR[0].url
              // no attachments or embeds
            }

            const embed = new Discord.MessageEmbed()
              .setAuthor(msg.author.username, avatarURL)
              .setColor(settings.hexcolor)
              .setDescription(contentMsg)
              .setImage(eURL)
              .setTimestamp(new Date())
              .setFooter(messageFooter)
            postChannel.send({
              embed
            }).then((starMessage) => {
              messagePosted[msg.id].psm = starMessage.id
            })
          }
        }
      }
    })

    // if reactions reach 0
    if (!found)
      deletePost(msg)

  })
}

// delete a post
function deletePost (msg) {
  const postChannel = client.guilds.cache.get(guildID).channels.cache.get(smugboardID)
  // if posted to channel board before
  if (messagePosted[msg.id]) {
    const editableMessageID = messagePosted[msg.id].psm
    postChannel.messages.fetch(editableMessageID).then((message) => {
      delete messagePosted[msg.id]
      message.delete()
        .then(msg => console.log(`Removed message with ID ${editableMessageID}. Reaction count reached 0.`))
        .catch(console.error)
    })
  }
}

// ON READY
client.on('ready', () => {
  console.log(`Logged in as ${client.user.username}!`)
  guildID = settings.serverID
  smugboardID = settings.channelID
  // fetch existing posts
  loadIntoMemory()
})

// ON REACTION ADD
client.on('messageReactionAdd', (reaction_orig, user) => {
  if (loading) return
  // if channel is posting channel
  if (reaction_orig.message.channel.id == smugboardID) return
  // if reaction is not desired emoji
  if (reaction_orig.emoji.name !== settings.reactionEmoji) return

  const msg = reaction_orig.message

  // if message doesnt exist yet in memory, create it
  if (!messagePosted.hasOwnProperty(msg.id)) {
    // p: boolean: has been posted to channel,
    // lc: int: number of stars
    messagePosted[msg.id] = {
      p: false,
      lc: 0
    }
  } else {
    if (messagePosted[msg.id].legacy) {
      console.log(`Legacy message ${settings.reactionEmoji}'d, ignoring`)
      return
    }
  }

  manageBoard(reaction_orig)
})

// ON REACTION REMOVE
client.on('messageReactionRemove', (reaction_orig, user) => {
  if (loading) return
  // if channel is posting channel
  if (reaction_orig.message.channel.id == smugboardID) return
  // if reaction is not desired emoji
  if (reaction_orig.emoji.name !== settings.reactionEmoji) return


  manageBoard(reaction_orig)
})

// ON REACTION PURGE
client.on('messageReactionRemoveAll', (msg) => {
  deletePost(msg)
})


client.login(process.env.TOKEN); //login bot using token
