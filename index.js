'use strcit'

const Discord = require('discord.js')
const { Network, TransactionType, Transaction, Key } = require('semux-js')
const Long = require('long')
const rp = require('request-promise')
const botSettings = require('./config/config-bot.json')
const getPrice = require('./getPrice.js')
const { Users } = require('./models')

const prefix = botSettings.prefix
const bot = new Discord.Client({ disableEveryone: true })

const API = 'https://api.semux.online/v2.1.0/'
const FEE = 5000000

bot.on('ready', () => {
  console.log('Bot is connected.')
})

async function getAddress (address) {
  return JSON.parse(await rp(API + 'account?address=' + address))
}

async function sendToApi (tx) {
  const serialize = Buffer.from(tx.toBytes().buffer).toString('hex')
  try {
    var { result } = await rp({
      method: 'POST',
      uri: `${API}transaction/raw?raw=${serialize}&validateNonce=true`,
      json: true
    })
  } catch (e) {
    console.log(e)
  }
  if (result) {
    return result
  }
}

async function sendCoins (authorId, toAddress, value, msg) {
  if (!toAddress || !value) {
    return {
      error: true,
      reason: 'Amount of SEM and Discord Username are required.'
    }
  }
  const from = await Users.findOne({ where: { discord_id: authorId } })
  if (!from) {
    return {
      error: true,
      reason: "You don't have account yet, type /getAddress first."
    }
  }
  var isFrom = await getAddress(from.address)
  try {
    await getAddress(toAddress)
  } catch (e) {
    return { error: true, reason: 'Wrong recipient, try another one.' }
  }
  if (value.includes(',')) value = value.replace(/,/g, '.')
  let amount = parseFloat(value)
  if (!amount) return { error: true, reason: 'Amount is not correct.' }
  amount = amount * Math.pow(10, 9)
  if (amount < 0.000000001) return { error: true, reason: 'Wrong amount, try another one.' }
  // check reciever balance before transfer
  const fromAddressBal = await getAddress(from.address)
  let nonce = parseInt(isFrom.result.nonce, 10) + parseInt(isFrom.result.pendingTransactionCount, 10)
  const available = parseFloat(fromAddressBal.result.available)
  if (available === amount) {
    amount = amount - FEE
  }
  if (available < (amount + FEE)) {
    return { error: true, reason: `Insufficient balance, you have **${parseBal(available)} SEM**` }
  }
  const privateKey = Key.importEncodedPrivateKey(hexBytes(from.private_key))
  try {
    var tx = new Transaction(
      Network.MAINNET,
      TransactionType.TRANSFER,
      hexBytes(toAddress), // to
      Long.fromNumber(amount), // value
      Long.fromNumber(FEE), // fee
      Long.fromNumber(nonce), // nonce
      Long.fromNumber(new Date().getTime()), // timestamp
      '0x746970' // data
    ).sign(privateKey)
  } catch (e) {
    console.log(e)
  }
  let hash = await sendToApi(tx)

  if (!hash) {
    return { error: true, reason: 'Error while tried to create transaction.' }
  } else {
    return { error: false, hash }
  }
}

async function changeStats (senderId, recieverId, value) {
  if (value.includes(',')) value = value.replace(/,/g, '.')
  let amount = parseFloat(value)
  let sender = await Users.findOne({ where: { discord_id: senderId } })
  let reciever = await Users.findOne({ where: { discord_id: recieverId } })
  await sender.update({
    sent: sender.sent + amount
  })
  await reciever.update({
    received: reciever.received + amount
  })
}

bot.on('message', async msg => {
  const args = msg.content.split(' ')
  const authorId = msg.author.id

  if (msg.content === `${prefix}topDonators`) {
    let donatorsList = await Users.findAll({ order: [['sent', 'DESC']], where: { 'sent': { $ne: null } }, limit: 10 })
    let string = 'Top-10 donators:\n'
    let i = 1
    for (let row of donatorsList) {
      string += `${i++}) ${row.username} **${row.sent.toFixed(3)}** SEM\n`
    }
    return msg.channel.send(string)
  }

  if (msg.content === `${prefix}topRecipients`) {
    let recievesList = await Users.findAll({ order: [['received', 'DESC']], where: { 'received': { $ne: null } }, limit: 10 })
    let string = 'Top-10 recipients:\n'
    let i = 1
    for (let row of recievesList) {
      string += `${i++}) ${row.username} **${row.received.toFixed(3)}** SEM\n`
    }
    return msg.channel.send(string)
  }

  // tip to username
  if (msg.content.startsWith(`${prefix}tip `)) {
    const amount = args[2]
    const username = args[1]
    if (username.includes('@')) {
      var usernameId = username.substring(2, username.length - 1)
    }

    let userAddress = await Users.findOne({ where: { discord_id: usernameId } })
    if (!userAddress) {
      const key = Key.generateKeyPair()
      const privateKey = toHexString(key.getEncodedPrivateKey())
      const address = '0x' + key.toAddressHexString()
      const newUserName = bot.users.find(user => user.id === usernameId)
      if (!newUserName) {
        return msg.reply('Cannt find this user on the server.')
      }
      var newRegister = await Users.create({
        username: newUserName.username,
        discord_id: usernameId,
        address: address,
        private_key: privateKey
      })
      userAddress = newRegister.address
    } else {
      userAddress = userAddress.address
    }
    let reciever = bot.users.find(user => user.id === usernameId)
    if (!reciever) return msg.reply('Wrong username, try another one')
    try {
      var trySend = await sendCoins(authorId, userAddress, amount, msg)
    } catch (e) {
      // console.log(e)
    }
    if (trySend.error) return msg.reply(trySend.reason)
    await changeStats(authorId, usernameId, amount)
    await reciever.send(`You've received tips. TX: <https://semux.info/explorer/transaction/${trySend.hash}> \nSend me: \`/balance\` or \`/help\` to find more details`)
    await msg.reply(`Tip sent. TX: <https://semux.info/explorer/transaction/${trySend.hash}>`)
  }

  // get donate address
  if (msg.content.startsWith(`${prefix}getAddress`)) {
    const user = await Users.findOne({ where: { discord_id: authorId } })
    if (!user) {
      const key = Key.generateKeyPair()
      const privateKey = toHexString(key.getEncodedPrivateKey())
      const address = '0x' + key.toAddressHexString()
      if (address) {
        msg.author.send(`This is your unique deposit address: **${address}**\nYou can deposit some SEM to this address and use your coins for tipping.\nPeople will be tipping to this address too. Try to be helpful to the community ;)`)
        await Users.create({
          username: msg.author.username,
          discord_id: authorId,
          address: address,
          private_key: privateKey
        })
      }
    } else {
      return msg.author.send(`Your deposit address is: **${user.address}**`)
    }
  }

  // withdraw
  if (msg.content.startsWith(`${prefix}withdraw`)) {
    const amount = args[2]
    const toAddress = args[1]
    let trySend
    try {
      trySend = await sendCoins(authorId, toAddress, amount, msg)
    } catch (e) {
      // console.log(e)
    }
    if (trySend.error) {
      msg.author.send(trySend.reason)
    } else {
      msg.author.send('Your withdrawal request has been processed successfully. Broadcasting transaction to the network now.')
    }
  }

  // balance
  if (msg.content.startsWith(`${prefix}balance`) || msg.content.startsWith(`${prefix}bal`)) {
    const price = getPrice()
    const user = await Users.findOne({ where: { discord_id: authorId } })
    if (!user) return msg.reply("Sorry, but you don't have account, type **/getAddress** first.")
    const userBal = JSON.parse(await rp(API + 'account?address=' + user.address))
    if (userBal.success) {
      const availabeBal = numberFormat(parseBal(userBal.result.available))
      // const lockedBal = numberFormat(parseBal(userBal.result.locked))
      const totalBal = parseBal(userBal.result.available) + parseBal(userBal.result.locked)
      let usdBalance = price * totalBal
      usdBalance = numberFormat(usdBalance)
      if (totalBal > 50000) {
        msg.channel.send(`Your balance is: **${availabeBal}** SEM (*${usdBalance} USD*), congrats, you are the whale.`)
      } else if (totalBal > 1000 && totalBal < 3000) {
        msg.channel.send(`Your balance is: **${availabeBal}** SEM (*${usdBalance} USD*), congrats, you are the dolphin.`)
      } else if (totalBal >= 3000 && totalBal < 10000) {
        msg.channel.send(`Your balance is: **${availabeBal}** SEM (*${usdBalance} USD*), congrats, you are the shark.`)
      } else if (totalBal === 0) {
        msg.channel.send(`Your wallet is empty: **${availabeBal}** SEM`)
      } else {
        msg.channel.send(`Your balance is: **${availabeBal}** SEM (*${usdBalance} USD*),  you need more SEM to become a whale.`)
      }
    } else {
      return msg.channel.send('Semux api issues')
    }
  }

  if (msg.content === `${prefix}stats`) {
    const price = getPrice()
    try {
      var { result } = JSON.parse(await rp(API + 'info'))
    } catch (e) {
      return msg.channel.send('Lost semux connection')
    }
    if (result) {
      return msg.channel.send(`Semux price: **${price} USD**\nSemux Last Block: **${result.latestBlockNumber}**\nPending Txs: **${result.pendingTransactions}**\nPeers: **${result.activePeers}**`)
    }
  }

  if (msg.content === `${prefix}help`) {
    msg.channel.send(`SemuxBot commands:\n` +
      `**${prefix}balance** - show your balance.\n` +
      `**${prefix}tip** *<@username>* *<amount>* - send SEM to a Discord user.\n` +
      `**${prefix}withdraw** *<address>* *<amount>* - withdraw SEM to your personal address.\n` +
      `**${prefix}getAddress** - get your personal deposit/tips address.\n` +
      `**${prefix}topDonators** - show the most active donators.\n` +
      `**${prefix}topRecipients** - show the luckiest recipients.\n` +
      `**${prefix}stats** - show current Semux network stats.`
    )
  }
})

function numberFormat (balance) {
  const balanceInt = new Intl.NumberFormat('us-US').format(balance)
  return balanceInt
}

function parseBal (balance) {
  return parseFloat((parseFloat(balance) / Math.pow(10, 9)).toFixed(10))
}

function hexBytes (s) {
  return Buffer.from(s.replace('0x', ''), 'hex')
}

function toHexString (byteArray) {
  return Array.from(byteArray, function (byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2)
  }).join('')
}

bot.login(botSettings.token)
