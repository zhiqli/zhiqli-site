---
title: "代码仓库迁移引发的包引用问题"
date: 2024-04-08
description: "奇怪的问题，简单的原因"
tags: [笔记,go]
---

奇怪的问题，简单的原因
## 背景
最近有个服务所在仓库的其他服务都交接给了其他团队，加上两个团队使用的一些依赖版本不一致，导致如果一直在这个仓库修改的话会带来一些编译和维护上的问题。于是决定出来，在迁移时除了本服务的代码还有一些依赖的公共代码也一起迁移出来了。但在重新发版以后奇怪的问题发生了。

## 问题
服务发布后第三天 SRE 联系，这个服务的内存一直在涨。从业务上这是一个调用量非常低的服务，不可能会使用大量内存。并且在过去几年负载一直都处于非常低的状态。
![Pasted image 20240407082241.png](https://raw.githubusercontent.com/zhiqli/imgs/main/Pasted%20image%2020240407082241.png)
## 定位
首先回忆，本次修改的内容

1. 仓库迁移，只是把代码迁移出来而已。
2. 修改 redis host，也是本次修改的目的，其他几十个服务有同用的修改，可以排除。
3. 为了和其他所有服务统一，升级了 base image 和 go 版本。难道问题出在这里？好像也说不通，毕竟其他服务都已经升级，而且系统和 go 都是稳定版本。

看起来并不能一眼看穿，Let’s dive in。

### pprof 查看内存
![Pasted image 20240407082429.png](https://raw.githubusercontent.com/zhiqli/imgs/main/Pasted%20image%2020240407082429.png)

发现绝大部分占用来自prometheus.newSummary 这个函数，很显然是来自监控上报。检查修改前后的 prometheus client_golang 的依赖版本，并无变化。

### 查看metrics
先本地看看 metrics 的情况。发现异常指标，这个指标的 api_name 这个 label是一个很独立的字符串，不是一个合适的监控指标。统计了一下果然很多，有数十万之多。
![Pasted image 20240407082544.png](https://raw.githubusercontent.com/zhiqli/imgs/main/Pasted%20image%2020240407082544.png)

奇怪了，难道之前就没有这个指标吗？拉出一个监控看了看，还确实就是从发布以后才出现的。
![Pasted image 20240407082739.png](https://raw.githubusercontent.com/zhiqli/imgs/main/Pasted%20image%2020240407082739.png)

### 分析代码
代码中，上报监控都是来自一个 reportMetrics 函数
```
func reportMetrics(requestPath, httpMethod string, statusCode int, costTime float64, c *gin.Context) {
    arr := strings.Split(requestPath, "/")
    if len(arr) < 6 {
        return
    }
 
    apiName := fmt.Sprintf("%s_%s_%s", httpMethod, arr[4], arr[5])
 
    err := reporter.ReportSummary(REQUEST_LATENCY, costTime,
        reporter.Label{Key: "api_name", Val: apiName},
        reporter.Label{Key: "status_code", Val: strconv.Itoa(statusCode)})
    common_metrics.HandlerReportErr(err, REQUEST_LATENCY)
 
    if c.Writer.Written() {
        err := reporter.ReportSummary(RESPONSE_SIZE, float64(c.Writer.Size()),
            reporter.Label{Key: "api_name", Val: apiName},
            reporter.Label{Key: "status_code", Val: strconv.Itoa(statusCode)})
    }
 
}
```

在这里猜测是不是老版本的 path 通过 / split 以后都小于 6 呢？ 从上面的代码  path := c.Request.URL.Path，难道是 go 版本升级以后，Path 返回的内容不一样了？

在验证这个问题之前，找出老代码进行对比。发现两个仓库的代码不一样。

```
func reportMetrics(requestPath, httpMethod string, statusCode int, costTime float64, c *gin.Context) {
    arr := strings.Split(requestPath, "/")
    if len(arr) < 4 {
        return
    }
    appName := arr[1]
    apiName := fmt.Sprintf("%s_/%s/%s/%s", httpMethod, arr[1], arr[2], arr[3])  // 问题的关键点
 
    err := reporter.ReportSummary(reqMetricsName, costTime,
        reporter.Label{Key: "api_name", Val: apiName},
        reporter.Label{Key: "status_code", Val: strconv.Itoa(statusCode)},
        reporter.Label{
            Key: "app_name",
            Val: appName,
        })
 
    if c.Writer.Written() {
        err := reporter.ReportSummary(GameShareFileMetricName, float64(c.Writer.Size()),
            reporter.Label{Key: "api_name", Val: apiName},
            reporter.Label{Key: "status_code", Val: strconv.Itoa(statusCode)},
            reporter.Label{
                Key: "app_name",
                Val: appName,
            })

    }
 
}
```

没有修改到这里的代码啊，为什么会不一样呢？在老代码中，apiName 取的是 `arr[1]`,`arr[2]`, `arr[3]`。其实对比可以发现 metrics name 也不一样的，所以上面看到上面的监控是发布以后才出现的。

## 原因
先说结论，在老代码里面有两个 common/middleware package 导致，新代码调整目录结构后修改 import 时出错。

以下是迁移前的目录结构
```
service
|__common
|   |__middleware
|       |__ LogMiddleware.go
|
|__myserver
|   |__common
|   |   |__middleware
|   |       |__ LogMiddleware.go  // 正确的引用
|   |__main
|       |__ main.go
```
迁移后的代码结构
```
myserver
|__common
|   |__middleware
|       |__ LogMiddleware.go  // 正确的引用
|
|__servicecommon // 即上面 service/common，因为里面有一些公共的依赖，必须迁移过来，因为 common 重名所以换了个名字
|   |__middleware
|       |__ LogMiddleware.go  // 错误的引用
|
|__main
    |__ main.go
```

从上面的分析可以清晰看出，在原来的代码结构中，有两层 common，而且都有一样的函数。所以导致迁移以后在修改依赖路径时错误的引用到了外层的函数。
## 结论
这次问题表现是内存一直涨，但实际上是因为不合理的代码结构导致的错误引用。当然，修改的人为错误必须承认，但更合理的结构可以避免这个错误。

在 《[100 go mistake and how to avoid them](https://zhiqli.github.io/2024/02/100-go-mistakes-and-how-to-avoid-them/)》这本书中，作者提出不建议使用 common、util 这些package name。尤其是在同一个项目中，不同目录下相同的 package 名称和代码结构，此为大忌。

另一个问题，这个上报其实是在 LogMiddleware 函数中去实现的，而这个 middleware 实际上是一个比较抽象、通用的函数，不建议在里面做一些特定的操作，比如解析 path，去获取具体的位数作为 metric label。一条不符合特定规则的 path 可能就会导致metric 爆炸。