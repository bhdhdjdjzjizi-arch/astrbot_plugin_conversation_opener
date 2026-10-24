"""astrbot_plugin_conversation_opener

群会话开启助手：列出机器人加入的全部群聊，标出哪些群还没有「活跃对话」，
在插件页面里勾选即可为这些群创建对话。

背景：AstrBot 的主动回复（可能性回复）必须挂在群已有的活跃对话上才能发出。
从没人 @ 过机器人、没跟它聊过的群没有活跃对话，主动回复掷中概率也会被丢弃
（日志报错 "No active conversation is available for proactive replies"）。
本插件把「给缺对话的群补建对话」做成可视化操作，免去逐群 /new 或改数据库；
v1.1.0 起也支持反向操作：勾选已开启的群关闭会话（删除其当前对话）。

实现：群列表经 OneBot 的 get_group_list 获取；是否有活跃对话用
ConversationManager.get_curr_conversation_id 判断；创建对话用官方
ConversationManager.new_conversation（与内置 /new 指令同一入口，不动已有对话）。
"""

from astrbot.api import logger
from astrbot.api.star import Context, Star
from astrbot.api.web import error_response, json_response, request

PLUGIN_NAME = "astrbot_plugin_conversation_opener"


class ConversationOpenerPlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)
        context.register_web_api(
            f"/{PLUGIN_NAME}/groups",
            self.api_list_groups,
            ["GET"],
            "列出全部群聊及会话开启状态",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/enable",
            self.api_enable_groups,
            ["POST"],
            "为勾选的群创建活跃对话",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/disable",
            self.api_disable_groups,
            ["POST"],
            "关闭勾选群的会话（删除其当前对话）",
        )

    # ------------------------------------------------------------------
    # 工具
    # ------------------------------------------------------------------
    def _find_qq_platform(self):
        """找到 aiocqhttp 平台实例，返回 (platform_id, bot) 或 (None, None)。"""
        try:
            insts = self.context.platform_manager.platform_insts
        except Exception:
            return None, None
        for inst in insts:
            try:
                meta = inst.meta()
            except Exception:
                continue
            if getattr(meta, "name", "") == "aiocqhttp":
                return getattr(meta, "id", "default"), getattr(inst, "bot", None)
        return None, None

    async def _collect_groups(self):
        """返回 (groups, error)：groups 为带会话状态的群列表。"""
        platform_id, bot = self._find_qq_platform()
        if bot is None:
            return None, "没有找到已连接的 QQ（aiocqhttp）平台实例，机器人可能尚未登录。"
        try:
            raw = await bot.api.call_action("get_group_list")
        except Exception as e:
            return None, f"获取群列表失败：{e}"
        conv_mgr = self.context.conversation_manager
        groups = []
        for g in raw or []:
            gid = str(g.get("group_id", "")).strip()
            if not gid:
                continue
            umo = f"{platform_id}:GroupMessage:{gid}"
            cid = await conv_mgr.get_curr_conversation_id(umo)
            groups.append(
                {
                    "id": gid,
                    "name": str(g.get("group_name", "") or gid),
                    "member_count": g.get("member_count"),
                    "has_conversation": cid is not None,
                }
            )
        # 未开启的排前面，其余按群名
        groups.sort(key=lambda x: (x["has_conversation"], x["name"]))
        return {"platform_id": platform_id, "groups": groups}, None

    # ------------------------------------------------------------------
    # Web API
    # ------------------------------------------------------------------
    async def api_list_groups(self):
        result, err = await self._collect_groups()
        if err:
            return error_response(err, status_code=503)
        groups = result["groups"]
        missing = sum(1 for g in groups if not g["has_conversation"])
        return json_response(
            {
                "total": len(groups),
                "missing": missing,
                "groups": groups,
            }
        )

    async def api_enable_groups(self):
        payload = await request.json(default={})
        group_ids = payload.get("group_ids") or []
        if not isinstance(group_ids, list) or not group_ids:
            return error_response("没有勾选任何群", status_code=400)
        platform_id, bot = self._find_qq_platform()
        if bot is None:
            return error_response("QQ 平台未连接", status_code=503)
        conv_mgr = self.context.conversation_manager
        created, skipped, failed = [], [], []
        for raw_gid in group_ids:
            gid = str(raw_gid).strip()
            if not gid:
                continue
            umo = f"{platform_id}:GroupMessage:{gid}"
            try:
                if await conv_mgr.get_curr_conversation_id(umo) is not None:
                    skipped.append(gid)
                    continue
                await conv_mgr.new_conversation(umo, platform_id)
                created.append(gid)
            except Exception as e:
                logger.warning(f"[conversation_opener] 为群 {gid} 创建对话失败: {e}")
                failed.append(gid)
        logger.info(
            f"[conversation_opener] 已为 {len(created)} 个群开启会话，"
            f"跳过 {len(skipped)} 个，失败 {len(failed)} 个"
        )
        return json_response(
            {"created": created, "skipped": skipped, "failed": failed}
        )

    async def api_disable_groups(self):
        payload = await request.json(default={})
        group_ids = payload.get("group_ids") or []
        if not isinstance(group_ids, list) or not group_ids:
            return error_response("没有勾选任何群", status_code=400)
        platform_id, bot = self._find_qq_platform()
        if bot is None:
            return error_response("QQ 平台未连接", status_code=503)
        conv_mgr = self.context.conversation_manager
        closed, skipped, failed = [], [], []
        for raw_gid in group_ids:
            gid = str(raw_gid).strip()
            if not gid:
                continue
            umo = f"{platform_id}:GroupMessage:{gid}"
            try:
                if await conv_mgr.get_curr_conversation_id(umo) is None:
                    skipped.append(gid)
                    continue
                await conv_mgr.delete_conversation(umo)
                closed.append(gid)
            except Exception as e:
                logger.warning(f"[conversation_opener] 关闭群 {gid} 的会话失败: {e}")
                failed.append(gid)
        logger.info(
            f"[conversation_opener] 已关闭 {len(closed)} 个群的会话，"
            f"跳过 {len(skipped)} 个，失败 {len(failed)} 个"
        )
        return json_response(
            {"closed": closed, "skipped": skipped, "failed": failed}
        )
