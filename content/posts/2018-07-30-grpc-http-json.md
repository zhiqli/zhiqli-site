---
title: "grpc转换为http对外服务"
date: 2018-07-30
tags: [go,grpc]
---

# grpc转换为http对外服务
grpc支持将协议转换成http对外服务，数据通过post json提交
相对于普通的grpc服务，只需要在定义pb时稍作修改即可
```
syntax = "proto3";

package helloworld;
import "google/api/annotations.proto";

service srv {
    rpc Say(HelloReq) returns (HelloResp){
        option (google.api.http) = {
            post: "/say/hello"                  
            body: "*"
        };
    }
}
```

调用:`curl -X POST http://127.0.0.1:8080/say/hello -d {}`
相对于普通pb多了
`import "google/api/annotations.proto";`
```
option (google.api.http) = {
            post: "/say/hello"                  
            body: "*"
        };
```
