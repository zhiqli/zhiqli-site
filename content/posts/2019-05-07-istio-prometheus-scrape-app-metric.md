---
title: "istio 抓取应用程序的metric"
date: 2019-05-07
tags: [istio,笔记]
---

istio中会对网格内数据的metric数据收集，也可以自定义一些新的metric。通过这些数据有助于了解流量如何在集群中流动的。但这些数据不包括应用程序业务层的数据。
我们的应用中都有调用prometheus的go client api统计一些业务层的数据，由应用服务暴露一个端口。这些应用层的数据抓取当然可以起一个独立的prometheus服务，在istio1.1中，也可以使用istio的prometheus来收集。
本文主要记录采用istio prometheus抓取数据的配置。
### 配置
在文档中没有提及抓取收集应用程序metrics，这个描述是在FAQ中，[Istio / Metrics and Logs FAQ](https://istio.io/help/faq/metrics-and-logs/#prometheus-application-metrics)。在`install/kubernetes/istio-demo.yaml`或`install/kubernetes/istio-demo-auth.yaml`的prometheus ConfigMap配置中有两个job
```

    - job_name: 'kubernetes-pods'
      kubernetes_sd_configs:
      - role: pod
      .....
    - job_name: 'kubernetes-pods-istio-secure'
      scheme: https
```
在没有启用mutual TLS 的环境中，job `kubernetes-pods`会从 Pod 中收集应用的metric。如果 Istio 启用了mutual TLS，就由job `kubernetes-pods-istio-secure`完成应用metric的收集工作。
这两个job都需要在pod yaml中添加annotations
```
prometheus.io/scrape: "true"
prometheus.io/path: "<metrics path>"
prometheus.io/port: "<metrics port>"
```
## 应用
OK，查完文档，开始实践。我的环境没有开启mutual TLS 。
服务起来以后查看prometheus target，奇怪的事情发生了

![image](https://user-images.githubusercontent.com/3350002/64666329-7d0aa080-d488-11e9-95df-8d4f29c751d6.png)

我的服务在`kubernetes-pods-istio-secure` job下，而在这个job下指定了scheme为https。由于没有配置https，访问不通。
经过一番google还是没有找到问题，后面看到`kubernetes-pods`的配置里面有一个`source_labels: [__meta_kubernetes_pod_annotation_sidecar_istio_io_status, __meta_kubernetes_pod_annotation_prometheus_io_scheme]`于是在pod yaml annotations增加`Prometheus.io/scheme: "http"`
再次刷新网页，我的3个应用出现在`kubernetes-pods`，状态也为UP。

![image](https://user-images.githubusercontent.com/3350002/64666368-a88d8b00-d488-11e9-85b7-66312dbafe78.png)

进入graph搜索，应用程序的metric可以搜到

![image](https://user-images.githubusercontent.com/3350002/64666387-bb07c480-d488-11e9-8409-5e597a505645.png)

至于在annotations没添加scheme http时为什么给分配到job `kubernetes-pods-istio-secure` 也不明白。但问题总算解决了。
## 结论
这个简单的问题花了很多时间，回头来看走了这么多弯路还是对prometheus、istio不够了解，基础知识还欠缺。
