"""Call a running PostgreSQL-backed server; approval requires --approve."""
import argparse
import asyncio
import json
import os

import httpx


async def demo(args):
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        raise SystemExit("Set SUPABASE_ACCESS_TOKEN to a Supabase login access token.")
    async with httpx.AsyncClient(base_url=args.base_url,timeout=180) as client:
        headers={"Authorization":f"Bearer {token}"}
        response=await client.post("/api/v1/agents/runs",headers=headers,json={"message":args.message,"groupId":args.group_id})
        response.raise_for_status()
        run=response.json()["data"]
        print(json.dumps(run,ensure_ascii=False,indent=2))
        if args.approve and run["status"] == "waiting_approval":
            response=await client.post(f"/api/v1/agents/runs/{run['runId']}/resume",headers=headers,json={"checkpointId":run["checkpointId"],"decision":"approve"})
            response.raise_for_status()
            print(json.dumps(response.json()["data"],ensure_ascii=False,indent=2))


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--base-url",default="http://127.0.0.1:8000")
    parser.add_argument("--group-id",required=True,help="An existing group owned by this user")
    parser.add_argument("--message",default="오후 3시 이후 일정을 생성해 주세요.")
    parser.add_argument("--approve",action="store_true",help="Actually approve and update the group schedule")
    asyncio.run(demo(parser.parse_args()))
