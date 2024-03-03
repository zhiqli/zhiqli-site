---
title: "envoy 代理http1.1"
date: 2019-09-10
tags: [envoy,笔记]
---


最近处理了一个envoy代理http1.1的问题，先简单介绍一下背景

## 背景
我们有一个长连接通道的项目，原来是通过http2.0连接。后来因为要做扫码登录的业务，所以使用 socket.io
支持了http1.1的连接，这是同事当时支持http1.1以后的[博客](https://segmentfault.com/a/1190000017751461)。
代理当初用的envoy是1.6 v1 API ，现在由于其他问题想升级envoy到新版本，而新版本已经不支持v1 API，在升级的过程中遇到一些问题，也花了不少时间，搞定以后以此文作为笔记。

### 服务部署结构
![7ABEC0B0-2C40-47BF-89B3-B85AA8F0481A](https://user-images.githubusercontent.com/3350002/64596783-2305ce80-d3e7-11e9-86cf-9b9877f6642d.png)

* front-envoy

这是一个网关。需要处理客户端http1.1的请求，在envoy API v1的时候非常简单，只需要在Route中加上`use_websocket=true`即可，[参考文档](https://www.envoyproxy.io/docs/envoy/v1.7.0/api-v1/route_config/route.html?highlight=use_websocket)。
但是在API v2，这个配置修改了，[参考文档](https://www.envoyproxy.io/docs/envoy/latest/api-v2/config/filter/network/http_connection_manager/v2/http_connection_manager.proto.html?highlight=upgrade_configs)，在`http_connection_mananger`中加`upgrade_configs`配置。

* envoy1

这实际上是k8s ingress，本来其实这个envoy就可以直接对外了，由于在阿里云slb的连接数有限制，所以才有在前面加了frontenvoy，有了frontenvoy连接会收敛，虽然front-envoy有一百多万连接，但到这里的连接数就很少了。

* envoy2

看得出来这是sidecar envoy。只需要加上sio的upstream cluster即可。

## 问题

背景已经交代清楚了，这里再说下问题。

1. envoy升级以后，按照配置设置了`upgrade_configs`，请求发现front-envoy一直报错，503 UR，即upstream reset。
再跟踪envoy1的trace日志，发现有一行日志`invalid frame: Invalid HTTP header field was received`。

2. 查了好久都没找到答案，上github提了一个issue，后来回复，由于envoy之间是http2连接，需要设置`allow_connect=true`才行，参考[文档描述](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/websocket.html?highlight=upgrade_configs#handling-http-2-hops)。
由于之前文档没有描述`allow_connect`，现在看到的是我提了issue才加上的描述。所以自己查了很久也没搞定。
![85E35B00-1ED3-4007-A063-057E975B8A26](https://user-images.githubusercontent.com/3350002/64596850-44ff5100-d3e7-11e9-955d-e3336b5c50f8.png)

3. 设置上`allow_connect`以后，frontenvoy的日志从503 UR变成503了。
查看envoy1的日志，503 UR 以及`invalid frame: Invalid HTTP header field was received`。和刚才envoy1一样的。

而envoy2已经设置了`allow_connect`啊。后来查明原来我是在`cluster`里面的`http2_protocol_options`中设置了`allow_connect=true`，需要在`http_connection_mananger`中的`http2_protocol_options`中设置。

4. 设置完成，envoy2又出现以下日志

```
[2019-09-10 07:14:56.094][000057][info][client] [source/common/http/codec_client.cc:118] [C3693] protocol error: The user callback function failed
[2019-09-10T07:14:55.632Z] "GET /xlchannel.app2amlogic/sio/?EIO=3&transport=websocket HTTP/2" 503 UC 0 57 1 - "192.168.61.139,172.30.30.103,172.30.30.116" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.132 Safari/537.36" "89018dc4-226f-4813-805d-7bb4d1332a60" "10.10.75.131" "127.0.0.1:8080"
```

再检查一遍配置，发现我在upstream cluster中加了`http2_protocol_options{}`这就指定协议为http2，v1配置可以用`"features":"http2",`配置为http2，默认http。而在v2配置中，需要通过`http2_protocol_options{}`指定协议为http2，`http_protocol_options{}`或不填表示http。


#### 再总结一下几个envoy需要修改的地方

* frontenvoy
`http_connection_mananger`中指定

```
"upgrade_configs": [{"upgrade_type": "websocket"}]
```

* envoy1、envoy2
`http_connection_mananger`中指定

```
"http2_protocol_options": { "allow_connect": true},
```
**且upstream cluster配置中不能将协议指定为http2**。
