---
title: "跑步"
date: 2025-05-14T08:06:49+08:00
draft: false
layout: "running"
description: "站内嵌入式跑步记录面板"
running:
  intro: "跑步记录保留在这个页面里。后续如果接入 Strava、Keep 或自建运动记录页，也会以内嵌窗口展示，不跳到外部网页。"
  embedUrl: ""
  monthLabel: "This month"
  monthDistance: "-- km"
  yearLabel: "This year"
  yearDistance: "-- km"
  streakLabel: "Streak"
  streak: "-- days"
  recentRuns:
    - title: "Morning loop"
      distance: "待记录"
      meta: "配速 / 心率 / 路线"
    - title: "Easy run"
      distance: "待记录"
      meta: "恢复跑"
    - title: "Long run"
      distance: "待记录"
      meta: "周末长距离"
---

这里会放跑步记录、训练感受和阶段目标。页面会从 `zhiqli/running_page` 的 `src/static/activities.json` 读取真实数据，并在博客自己的界面里渲染。
