---
title: "envoy ratelimit技术验证"
date: 2019-0816
tags: [envoy,笔记]
---

nginx大法好啊，nginx5分钟解决了一个envoy带来两周的伤害。

### 背景
具体情况是这样的，我这边有个服务大概结构是这样的。

![img](https://user-images.githubusercontent.com/3350002/63155615-7df51180-c045-11e9-90d5-072d7433da5b.png)

高峰时大概承接了150w的grpc长连接，以及小于1000的websocket长连接。
上个月底由于已发版的客户端有个bug，会在后台不停发websocket建立连接请求，导致在一个周日下午5点半线上服务频繁重启，还好k8s会自动拉起服务。在超市买菜做晚饭的我赶紧冲回去，这时候能咋办呢。

**扩容**，把pod数增加一倍，然而并没有卵用，还是秒挂。由于前端envoy有5个实例，跟领导报备，先做服务降级，把其中4个envoy关闭websocket，先保证这100来万grpc连接能正常啊。
挺过一晚上，周一去到公司，讨论了一上午，最后的方案是隔离，把最前面的envoy分离，websocket的域名只走单独的两个envoy。慢慢的服务平稳了一周。服务变成这样子

![img](https://user-images.githubusercontent.com/3350002/63155616-7e8da800-c045-11e9-86a4-0fad0e15fbcc.png)

第二周，同样的周日下午5:30，k8s ingress 又出现大面积重启，还是老方法，扩容，周一ingress也隔离。于是服务又变成这样子

![img](https://user-images.githubusercontent.com/3350002/63155617-7e8da800-c045-11e9-8ab0-8a3ed4e9b251.png)

同时调研envoy ratelimit，这又是一个悲伤的故事。由于我们用的还是envoy1.6或者1.7（别问为什么，问就是以前团队留下的坑），试了ratelimt发现，grpc和http都能有效限制remote_address的请求次数，就是websocket无效。又验证最新的envoy，发现没有问题。

这时候升级envoy就完事了吧，领导觉得动作太大，因为从网关到服务，实际上有三个envoy（包括sidecar里面的envoy），都得升级，否则websocket请求全部是503 UR，还不保证服务里面的socket io相关代码不需要修改。

最后祭出nginx大法。昨晚下班前5分钟在测试环境配置nginx，验证通过。
今天早上业务验证通过，上线，持续观察了几天，再也没有重启过，业务同学也再也没找过我了。

## 总结
总结一下这次解决问题的过程
envoy提供ratelimit的api，可以接入一个全局的速率限制服务，lyft已经提供了一个[ratelimt](https://github.com/lyft/ratelimit)服务可以参考甚至直接用。关于限速配置，readme中有详细说明。

关于envoy配置，官方文档中也有描述，不过各版本之间略有差异，需要针对各版本进行配置，最新版，网上有一个 [envoy_ratelimit_example](https://github.com/jbarratt/envoy_ratelimit_example) 
可以参考，而低版本则可以通过官文文档进行配置。

虽然这次折腾没有用上envoy ratelimit，不过也算是一次技术调研，在后面的服务中可能可以用上，特以此文作为笔记。