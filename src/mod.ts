import { DependencyContainer } from "tsyringe";
import { IPostDBLoadMod } from "@spt/models/external/IPostDBLoadMod";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { DatabaseService } from "@spt/services/DatabaseService";
import { IDatabaseTables } from "@spt/models/spt/server/IDatabaseTables";
import { ITrader } from "@spt/models/eft/common/tables/ITrader";
import { ILogger } from "@spt/models/spt/utils/ILogger";

// Enum for currency types
enum ECurrencyType 
    {
    RUB = "RUB", // Russian Ruble
    EUR = "EUR", // Euro
    USD = "USD"  // US Dollar
}

// Currency IDs
const currencyIds = {
    RUB: "5449016a4bdc2d6f028b456f", // ID for Russian Ruble
    EUR: "569668774bdc2da2298b4568", // ID for Euro
    USD: "5696686a4bdc2da3298b456a" // ID for US Dollar
};

// Interfaces for defining the structure of rewards and quests
interface IRewardItem 
{
    _id: string; // Unique ID for the item
    _tpl: string; // Template ID for the item
    upd: {
        StackObjectsCount: number; // Quantity of the item
    };
}

interface IReward 
{
    id: string; // Unique ID for the reward
    target: string; // Target of the reward
    type: string; // Type of reward (e.g., Item, Experience)
    value: number; // Value associated with the reward
    items?: IRewardItem[]; // Optional list of items included in the reward
}

interface IQuest 
{
    rewards: {
        Success: IReward[]; // Rewards provided upon successful quest completion
    };
    traderId: string; // ID of the trader who gives the quest
}

class OneEuroForSkier implements IPostDBLoadMod 
{
    private logger: ILogger; // Logger instance for logging messages
    private exchangeRate = 168; // Default exchange rate to prevent division by zero

    // Main method called after the database is loaded
    public postDBLoad(container: DependencyContainer): void 
    {
        this.logger = container.resolve<ILogger>("WinstonLogger");

        const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const traderTable = databaseServer.getTables().traders;
        const tables: IDatabaseTables = container.resolve<DatabaseService>("DatabaseService").getTables();
        const questTable = tables.templates.quests;

        // Find the Skier trader by nickname
        const skierTrader = this.findTrader(traderTable, "Skier");
        if (skierTrader) 
        {
            this.logger.info("[OneEuroForSkier] Updating Skier favourite currency...");
            this.updateTrader(skierTrader);
        }

        // Filter quests that belong to Skier using the trader ID
        const skierQuests = Object.values(questTable).filter(
            (quest: IQuest) => quest.traderId === "58330581ace78e27b8b10cee"
        );

        // Update rewards for each Skier quest
        skierQuests.forEach(quest => this.updateQuestRewards(quest));
    }

    // Updates trader's barter scheme and currency to use Euros
    private updateTrader(trader: ITrader): void 
    {
        const barterScheme = trader.assort.barter_scheme;
        const euroitem = "66e802a0ea847a407f0e4e65";
        const exchangeEntry = barterScheme[euroitem]?.[0]?.[0];

        // Retrieve the exchange rate for RUB to EUR if available
        if (exchangeEntry) 
        {
            this.exchangeRate = exchangeEntry.count;
        }

        // Update trader's currency to EUR if it's not already set
        if (trader.base.currency !== ECurrencyType.EUR) 
        {
            trader.base.loyaltyLevels.forEach(level => 
            {
                level.minSalesSum /= this.exchangeRate; // Adjust sales sum requirements
            });
            trader.base.currency = ECurrencyType.EUR;
        }

        // Adjust barter schemes to use EUR instead of RUB
        Object.entries(barterScheme).forEach(([barterId, barterInfo]) => 
        {
            // Skip the entry containing the exchange rate itself
            if (barterId === euroitem) return;

            // Iterate over each barter entry
            barterInfo.forEach(entry => 
            {
                if (entry.length === 1) 
                { // Process single-item barter entries only
                    const item = entry[0];
                    if (item._tpl === currencyIds.RUB) 
                    {
                        item.count = Math.max(1, Math.round(item.count / this.exchangeRate)); // Convert RUB to EUR
                        item._tpl = currencyIds.EUR; // Update to Euro template ID
                    }
                }
            });
        });

        this.logger.debug("[OneEuroForSkier] Trader data updated to use EUR."); 
    }

    // Updates the rewards of a given quest to use Euros
    private updateQuestRewards(quest: IQuest): void 
    {
        quest.rewards.Success.forEach(reward => 
        {
            if (reward.type === "Item" && reward.items) 
            {
                reward.items.forEach(item => 
                {
                    if (item._tpl === currencyIds.RUB) 
                    {
                        item._tpl = currencyIds.EUR; // Change item template to Euro
                        reward.value = Math.ceil((reward.value / this.exchangeRate) * 1.25); // Adjust reward value
                        item.upd.StackObjectsCount = reward.value; // Update stack count
                    }
                });
            }
        });

        this.logger.debug(`[OneEuroForSkier] Updated rewards for quest with trader ${quest.traderId}.`);
    }

    // Finds a trader by their nickname from the trader table
    private findTrader(traders: Record<string, ITrader>, nickname: string): ITrader | undefined 
    {
        return Object.values(traders).find(trader => trader.base.nickname === nickname);
    }
}

export const mod = new OneEuroForSkier();
