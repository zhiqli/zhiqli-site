---
title: "grpc established问题"
date: 2018-07-30
tags: [grpc]
---


### 问题起因
QA同事问我为什么服务建立连接以后，关闭防火墙过了一天netstat查看端口还是established状态。当时我也回答不出，但我觉得这是个好问题，于是花了点时间goole。

### 定位
首先找到一句话`The default value for the “TCP Established timeout” on a Linux server is 5 days. `
当时觉得不对啊，难道grpc没有heatch check的吗？
于是查看grpc的代码
```
// ClientParameters is used to set keepalive parameters on the client-side.
// These configure how the client will actively probe to notice when a connection is broken
// and send pings so intermediaries will be aware of the liveness of the connection.
// Make sure these parameters are set in coordination with the keepalive policy on the server,
// as incompatible settings can result in closing of connection.
type ClientParameters struct {
	// After a duration of this time if the client doesn't see any activity it pings the server to see if the transport is still alive.
	Time time.Duration // The current default value is infinity.
	// After having pinged for keepalive check, the client waits for a duration of Timeout and if no activity is seen even after that
	// the connection is closed.
	Timeout time.Duration // The current default value is 20 seconds.
	// If true, client runs keepalive checks even with no active RPCs.
	PermitWithoutStream bool // false by default.
}
```
从代码可以看出，grpc默认是不开启keepalive。和大牛讨论了一下。keepalive会加重系统负担，相当于kernel里面自己要做计时器管理，如果不设置则能释放kernel的资源。
一般上层应用也都会设置应用层的超时，tcp层的超时控制基本等于摆设，只有握手完成之前和应用发起关闭之后的状态，kernel里的控制才是必需的。
同时也参考了[这篇文章](http://blog.csdn.net/dog250/article/details/7262619)
