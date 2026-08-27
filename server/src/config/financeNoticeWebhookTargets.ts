/**
 * 财务通知钉钉群机器人：分仓/运营中心名称 → webhook
 * 推送时向本列表全部群各发一条（与战报 YEJI_BATTLE_TARGETS 思路一致，但 webhook 为财务专用群）
 *
 * 环境变量 FINANCE_NOTICE_TARGETS 可覆盖（格式：单位名|webhook,单位名|webhook）
 * FINANCE_NOTICE_WEBHOOK_URL / FINANCE_NOTICE_WEBHOOK_URLS 仍可作为兜底（逗号分隔 URL，无单位名）
 */

export interface FinanceNoticeWebhookTarget {
  unitName: string;
  webhook: string;
}

export const FINANCE_NOTICE_WEBHOOK_TARGETS: FinanceNoticeWebhookTarget[] = [
  {
    unitName: "南平分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=bc307a69dda4fa5fed3f9ab9b54b61ce0e3421c96d78762f8b799cc9bc1e22b0",
  },
  {
    unitName: "无锡运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=d20213b5ae65fc86611daf50890d6590ce42bcdcdc33ad44ff89bc5755ab916d",
  },
  {
    unitName: "武汉分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=f48a1d4cf9ec299e7891406be9d727a1ff9593088bcf79748ec3878ce3e0d8ae",
  },
  {
    unitName: "哈尔滨分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=be1d932db633e9163aa5c0d98bd49fc2bd576bb69b276181bbde7baac13d9269",
  },
  {
    unitName: "南京运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=f7ba1b2489bee901416e8e69207d05403f808fbe838681d0c55d48f5f7af4560",
  },
  {
    unitName: "四合院资源项目组",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=391941938fc5b73a468f65f587bbfa6da286804e912425bd37c2a4925b7e9103",
  },
  {
    unitName: "武汉运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=a0d28384257101bb7a0778f3a21fb683dd716488fa890c39f4c9407f7fe0e357",
  },
  {
    unitName: "深圳运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=8bfbb211d5ea8f0bf2d91170b77349dd7ca71a9df572076323203782d91411be",
  },
  {
    unitName: "龙鳞文创",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=fe5801df042269ac37d983ba84d101a7b84e5f07eb8d5022e99932cb555aeb3a",
  },
  {
    unitName: "宣城分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=17ebed6a4a5d831d46c7d78e08277ed782fc2666551b0f7183d5a4b5618f41eb",
  },
  {
    unitName: "青岛分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=39c756276ec97700e1ae69c5c1fc77be952cbacba1ca5aa2c688e83dc7e04431",
  },
  {
    unitName: "济南分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=eee1726d08d2b968696e56e1c5b0aba261a2cc28c7b6f6e6f353289b5380d928",
  },
  {
    unitName: "盐城分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=b661429c350455fb4a5d7dbf0127d6ac0b59200a04d220579b69127332caaaa0",
  },
  {
    unitName: "宿迁分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=4122cc3bb6cb31955eafe94388669edd267519add1d34e648b9d2fa5a1bbf917",
  },
  {
    unitName: "镇江分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=15eae760a255e5cbac1cb5d16b53394f64f193056e7414c7e598cc485d7498fd",
  },
  {
    unitName: "兰山分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=06de1567b3bc3ef13e99e7c12cf6056b7e7bf82a66307b2319dc02b3fb3e54d0",
  },
  {
    unitName: "泉州分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=e39b66021416e812da7b3ae22204ca5de75ca4847cdd057e13f28ae6d62b8c54",
  },
  {
    unitName: "新都分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=5c5c2a19ab66d448bb790809a418414af663d97c58533cc12c461ba5f826079d",
  },
  {
    unitName: "金牛分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=ca28d2b6217335847532528dea994eb551d6cf87740b14496903d67cfb5481be",
  },
  {
    unitName: "宜宾分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=414577251eb6c01826679f6f13bd59170e064a22e9b01510bb5d863a47acf2f6",
  },
  {
    unitName: "宜宾叙州分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=17cae951097e62cd9716ca75b8abf00b58d3ec8bc2019a05f70cc13945930f12",
  },
  {
    unitName: "天府分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=696438a0f4998e6a912102c5e7bc68e90ca00699cbab05751e401825a0f7fa2d",
  },
  {
    unitName: "绵阳分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=987b2930c7bb6b3c15c4462777cf1e67c993c23a1c37bfbc6bce47260b086775",
  },
  {
    unitName: "西安分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=9a35189267308a3e07c75b6de3dee6356803a4d8fa153a90bcbf59c299e45600",
  },
  {
    unitName: "石家庄代理",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=09287fad25ed9f012b0d1833e486fee505bcf3b4b75cc7383ffdc95111853316",
  },
  {
    unitName: "成都分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=5c1f1bd75b657e68326fc90486dd248b27d5a3177a12010228976da13955c6e5",
  },
  {
    unitName: "成都运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=b122d035820fb9ec545af66fcbcb3208f5e36b452617e7978a8b1c1fa628e876",
  },
  {
    unitName: "乌鲁木齐运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=7f886a8eb0e7aa654d9af79310e4f08388c607f9e4bafa64730bc3ebb0b44026",
  },
  {
    unitName: "贵阳分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=521d87dd86e4ae799167c2850b9e1a79ac5cdac8e01b129f516398a31af95825",
  },
  {
    unitName: "昆明分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=6f64f169c329f310a4cf71df5b66fcfb6622445d0338b79843423011d36e091b",
  },
  {
    unitName: "佛山运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=6dd705383004c38140e2e6e1b780bb65aa74cab8b5cfe000613c36b0155c54af",
  },
  {
    unitName: "抚州运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=9d89a1c3fca052e07a0193cacf5ba0a8eb82f1e2841377caf11ad98932f603b1",
  },
  {
    unitName: "海南运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=3ee86ed740bfbbef2f4494cd7d57be27a468552416992b3d6c77b26ac9e57075",
  },
  {
    unitName: "郑州分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=0f8d9d8f295490483340e804311ced27abc8f6112d0d5dbec08ed0ed578e3adb",
  },
  {
    unitName: "武昌分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=772e367e77eacc67257d518b8cab023a33bcba1ea596711762e91d75fcb0354a",
  },
  {
    unitName: "长沙分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=5b0f7b926400abba92fea8b00f92337ea31a265a76c71a66859e72341332855d",
  },
  {
    unitName: "九龙坡分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=ba1fc01adb58850a276efb1bb2b82d41a5455fd1752bf426f79ec048d097ea9e",
  },
  {
    unitName: "南阳分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=1f22ae1d849244618a02d2bade840e817f0f2a86096f602fb17cac3f90023c8c",
  },
  {
    unitName: "茂名分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=3f8929714742f82d460511f7d7375d253e825097e6108130fd6da499b6abe636",
  },
  {
    unitName: "潍坊分仓",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=a7749d384ac8e966a314822cc004b5c5960bbd1388b5cb05e62e6476d806d48b",
  },
  {
    unitName: "宜宾运营中心",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=1f6da2580ecdc64aa59e36de8fd7d6e36c682924fa62276caf5c566ebd0e9495",
  },
  {
    unitName: "太原服务站",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=149a994d3290cafa114e7345eba3f0e897498a88eefb456c47390733cb831316",
  },
  {
    unitName: "组织部业务通知对接群",
    webhook:
      "https://oapi.dingtalk.com/robot/send?access_token=3576f1021485be57f2b65f3f68ed3f7c293a540fa3621f2df5152f4b8ba64998",
  },
];

function parseEnvTargets(raw: string): FinanceNoticeWebhookTarget[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const idx = item.indexOf("|");
      if (idx <= 0) return null;
      const unitName = item.slice(0, idx).trim();
      const webhook = item.slice(idx + 1).trim();
      if (!unitName || !webhook) return null;
      return { unitName, webhook };
    })
    .filter((x): x is FinanceNoticeWebhookTarget => x !== null);
}

/** 当前生效的财务通知推送目标（环境变量可覆盖内置表） */
export function getFinanceNoticeWebhookTargets(): FinanceNoticeWebhookTarget[] {
  const env = (process.env.FINANCE_NOTICE_TARGETS || "").trim();
  if (env) {
    const parsed = parseEnvTargets(env);
    if (parsed.length > 0) return parsed;
  }
  return FINANCE_NOTICE_WEBHOOK_TARGETS;
}
