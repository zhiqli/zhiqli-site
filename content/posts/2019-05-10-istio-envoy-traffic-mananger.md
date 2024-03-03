---
title: "istio/envoy流量控制问题"
date: 2019-05-10
tags: [istio,笔记]
---

最近在调研istio，很重要的一点是想利用istio金丝雀发布时精细的流量控制。我们知道在k8s的金丝雀发布一般是通过label来控制，如果需要灰度1%的流量，那么总共需要100个pod。具体可以参考[这篇文章](https://mp.weixin.qq.com/s/dRHP25l_8jGh5UsNpI6jzA)。而istio则可以通过VirtualService来做流量控制，具体可以参考[官方文档](https://istio.io/docs/concepts/traffic-management/)。

结论是暂时istio无法满足我们的需求，还是在这里记录一下调研过程。
## 背景
先说下我们的服务架构，api-gateway和服务之间是采用grpc长连接，想要控制api-gatewasy与服务之间的流量。
服务的架构如下

![image](https://user-images.githubusercontent.com/3350002/64666771-040c4880-d48a-11e9-8a81-0a05a4f09062.png)

## istio流量控制
流量拆分具体案例参考[官方例子](https://istio.io/docs/tasks/traffic-management/traffic-shifting/)采用istio部署以后，部署VirutalService配置如下
```
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: reporter-vs
  namespace: istio
spec:
  hosts:
    - reporter
  http:
  - route:
    - destination:
        host: reporter
        subset: v1
      weight: 90
    - destination:
        host: reporter
        subset: v2
      weight: 10
---
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: reporter
  namespace: istio
spec:
  host: reporter
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
```
一开始90%的流量导向v1，10%的流量导向v2，测试正常。
修改VirutalService，10%流量到v1，90%的流量到v2，测试发现和修改前没有变化。
后来delete了api-gateway的pod重新拉起pod，发现VirutalService生效了。后面多次测试发现确实需要重新连接流量才会生效。

于是提了一个issue，官方给的答复如下

> As far as I know, Envoy won't intentionally close the connections just to get the load balancing even, it will only apply to new connections. We face a similar issue with the connection between Envoy and Pilot, which is long lasting.  
> Maybe there is a better solution, but one possible answer is to reconnect every X minutes, so that a new connection will be made and it will be load balanced。  

连接和流量貌似并没有必然的联系，于是接下来我又测试了envoy的流量拆分。

## envoy
业务服务有其他东西耦合，我重新写了一份代码用于验证。部署图如下

![image](https://user-images.githubusercontent.com/3350002/64666841-49c91100-d48a-11e9-9473-b2d54e02add0.png)

api-gateway和server之间依然采用grpc长连接，和前面一样。
envoy跑在docker中。

envoy配置如下
```
static_resources:
  listeners:
  - address:
      socket_address:
        address: 0.0.0.0
        port_value: 80
    filter_chains:
    - filters:
      - name: envoy.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.config.filter.network.http_connection_manager.v2.HttpConnectionManager
          codec_type: auto
          stat_prefix: ingress_http
          route_config:
            name: local_route
            virtual_hosts:
            - name: backend
              domains:
              - "*"
              routes:
                - match: 
                    prefix: "/"
                    grpc: {}
                  route:
                    weighted_clusters:
                      runtime_key_prefix: routing.traffic_split
                      clusters:
                        - name: service1
                          weight: 90
                        - name: service2
                          weight: 10
          http_filters:
          - name: envoy.router
            typed_config: {}
  clusters:
  - name: service1
    connect_timeout: 2s
    type: strict_dns
    lb_policy: round_robin
    http2_protocol_options: {}
    load_assignment:
      cluster_name: service1
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: 192.168.65.2 
                port_value: 9090
  - name: service2
    connect_timeout: 2s
    type: strict_dns
    lb_policy: round_robin
    http2_protocol_options: {}
    load_assignment:
      cluster_name: service2
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: 192.168.65.2 
                port_value: 9091 
admin:
  access_log_path: "/dev/null"
  address:
    socket_address:
      address: 0.0.0.0
      port_value: 8001
```
记录遇到的一个小问题，刚开始按照[官方front-envoy的配置](https://github.com/envoyproxy/envoy/blob/master/examples/front-proxy/front-envoy.yaml)简单修改发现死活连不上upstream。
后来看了`s2s-grpc-envoy.yaml`的[例子](https://github.com/envoyproxy/envoy/blob/master/examples/grpc-bridge/config/s2s-grpc-envoy.yaml)发现
```
              - match:
                  prefix: "/"
                  grpc: {}
```
加上`grpc: {}`以后就可以了

服务搭建好以后，先测试90%流量到service1，10%流量到service2，测试通过，不过感觉envoy的精确度没有isto高，有时候请求10次全部service1，而istio每次都能很精确，但大体不差可以说明问题。

然后通过动态修改配置，POST `127.0.0.1:8001/runtime_modify?routing.traffic_split.service1=10&routing.traffic_split.service2=90` 将10%的流量到service1，90%的流量到service2。再次测试，看到大部分流量已经转向service2了，验证通过。

## 结论
从上面的实验可以看出，流量和连接确实没有关系，envoy是支持动态修改流量控制的。但没有深入去看istio VirtualService的实现原理，也并不能下结论这就是有问题。
已经将验证结果更新至issue，期待对方回复，也希望能早点支持这个feature。
