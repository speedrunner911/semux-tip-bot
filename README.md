
# Discord-semux-tip-bot

Tip bot for Semux discord channel: https://discord.gg/qQVckKZ 

**Features:**
* deposit SEM to a personal address;
* send tips to discord users in SEM;
* check balance;
* withdraw SEM to a personal address;
* create a new address even if Recipient doesn't have account in bot's db yet
* show list of the most active donators.
* show list of the most luckiest recipients.
* show semux network stats

Try `/help` for more details.

## How to run
### Change configs
* Change config-bot.json file. 
* Add your semux username and password for api.
* Add bot token (generate it here - <https://discordapp.com/developers/applications/me>)
* Add or change prefix, you can use "!","/","$" or any another string.
### Run bot
* `cd semux-tip-bot`
* `npm install`
* `sequelize db:migrate`
* `node index.js`

## Maintainer
[@speedrunner911](https://github.com/speedrunner911)
