---
title: "基于argocd+kustomize实现金丝雀上线"
date: 2019-11-22
tags: [devops]
---

最近研究了一些CI/CD开源工具，目前项目CI依赖gitlab，但gitlab的CD功能太弱，所以调研其他一些工具看看能不能在生产应用。
* [spinnaker](https://www.spinnaker.io/) 可谓功能最全最为成熟支持多云，也相对复杂，是java栈，所以不予考虑。
* [gitlab](https://docs.gitlab.com/ee/ci/yaml/README.html#gitlab-cicd-pipeline-configuration-reference) 也有CD能力，但是太简单，本质上还是依赖.gitlab.yml，不方便控制。网上有很多如何配置gitlab cicd的文章。
* [tekton](https://github.com/tektoncd/pipeline) 云原生，版本还比较低，没部署使用。
* [argocd](https://argoproj.github.io/argo-cd/) 和git仓库能紧密结合，即gitops。目前一定迭代到1.3版本，界面简洁清晰。

## 部署
argoCD部署非常简单，两行代码搞定。

```
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```
![img](https://user-images.githubusercontent.com/3350002/69404265-d4a27380-0d37-11ea-95d6-d31924c08501.png)

[部署客户端](https://argoproj.github.io/argo-cd/getting_started/#2-download-argo-cd-cli)，有些操作在UI无法实现，需要通过客户端命令行来操作，

为了方便外部访问，增加一个ingress来提供外部访问，[参考文档](https://argoproj.github.io/argo-cd/operator-manual/ingress/)

配置完成以后便可通过浏览器访问页面，argocd自身只提供一个admin用户，密码为第一次启动时argo-server的pod name。这里要注意，尽快通过`argocd-cli account update-password `修改密码。否则pod重启以后就丢失了密码。

## 配置
部署成功登录以后，会发现页面非常简单，左侧有应用、设置和帮助三个选项。

1. 首先进入设置页面，配置Repositories，也可以通过客户端命令行添加。具体步骤[参考文档](https://argoproj.github.io/argo-cd/user-guide/private-repositories/)
![img](https://user-images.githubusercontent.com/3350002/69404035-24cd0600-0d37-11ea-8c0f-74f3f8751fef.png)

2. 添加项目，这一步比较简单，直接进去选择即可，至此可以回到应用页面去创建应用了。
3. 添加clusters，在网页上目前只能查看cluster，不能添加，添加需要有两种方式，默认有当前argocd所在的k8s集群，即in-cluster。
  * [一种](https://argoproj.github.io/argo-cd/operator-manual/security/#external-cluster-credentials)是直接在后台试用argocd-cli cluster add 命令，这种方式需要依赖本地的kubeconfig文件，且有执行kube-system的权限，因为cluster add需要在kube-system中添加secret。
  * [另外一种](https://argoproj.github.io/argo-cd/operator-manual/declarative-setup/#clusters)是通过添加一个argocd-cluster-cm config的方式，configmap中有一个baertoken不知为何物，所以没搞定。

4. 回到应用页面，添加应用，这个非常简单，添加选择完成点击create即可

![img](https://user-images.githubusercontent.com/3350002/69404191-9efd8a80-0d37-11ea-8ee6-034d5fdb6940.png)

## kustomize
kustomize是sig-cli的一个子项目，它的设计目的是给kubernetes的用户提供一种可以重复使用同一套配置的声明式应用管理，从而在配置工作中用户只需要管理和维护kubernetes的API对象，而不需要学习或安装其它的配置管理工具，也不需要通过复制粘贴来得到新的环境的配置。

在目前常用的kubectl版本中，子命令已经包含kustomiz，更多参考官方文档。提供[中文文档](https://github.com/kubernetes-sigs/kustomize/blob/master/examples/zh/README.md)，且有详细列子，具体不写了。

## 灰度发布
argopro还有一个项目argo-rollouts是支持蓝绿、金丝雀发布的，是基于helm来实现的。不过目前该项目版本比较低，且需要安装kubectl子命令来后台控制，所以暂不考虑。
可以配合kustomize一起来实现一个简单的灰度发布系统，当然也可以配合helm一起，不过helm的学习成本要高一点，先通过kustomize，后续可以再考虑helm。

在代码仓库中提供如下结构的kustomize目录。

```
├── kustomize
│   ├── base
│   │   ├── deployment.yaml
│   │   ├── kustomization.yaml
│   ├── canary
│   │   ├── kustomization.yaml
│   │   └── resource-patch.yaml
│   └── prod
│   ├── kustomization.yaml
│   └── resource-patch.yaml
```
* base/deployment.yaml就是一个普通的deployment
* base/kustomization.yaml

```
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
```

* canary/kustomization.yaml

```
bases:
- ../base
nameSuffix: -canary-v2		// 新版本deploy name suffix，实际上在base中提供service.yaml，每次也会创建新的service，也就是说实现了蓝绿发布了？
commonLabels:
  version: v2		// 新版本tag
  canary: "true"
patchesStrategicMerge:
- resource-patch.yaml	// 由于kubectl中的kustomize不支持replica 所以通过patch来控制replicas，在新版本的kustomize只修改replicas count 可以不用patch方式。
images:
- name: gitlab.cn/argo/argo-demo
  newTag: v2  // 灰度版本tag
```

* canary/resource-patch.yaml

```
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  labels:
    app: argo-demo
  name: argo-demo
  namespace: my-argo
spec:
  replicas: 0	// 先建一个空的deploy
  template:
    spec:
      containers:
      - name: argo-demo
        resources:		// 其他内容通过kustomize也可以添加
          requests:
            memory: "64Mi"
            cpu: "250m"
          limits:
            memory: "64Mi"
            cpu: "250m"
```

* prod中除了replica和label其他和canary中没有区别

接下来是灰度过程

1. 创建两个application，canary和staging分别表示灰度版本和稳定版本，其中canary版本对应的kustomize目录为kustomize/canary，staging版本对应的kustomize目录为kustomize/prod。
![img](https://user-images.githubusercontent.com/3350002/69404610-a8d3bd80-0d38-11ea-8371-2d14627d8b5d.png)

2. 假设当前稳定版本是v2.0.0，即将灰度v3.0.0，将argo-demo-canary的target revision修改为v3.0.0，sync即可，由于提交时canary的replicas是0，修改成1这时argo-demo-canary的demployment就是v3。
![img](https://user-images.githubusercontent.com/3350002/69404691-d7519880-0d38-11ea-8fcd-7597b3bf3f90.png)

3. 同时修改canary和staging中MANIFEST中的replicas来修改pod的副本数，此消彼长，控制灰度版本比例
![img](https://user-images.githubusercontent.com/3350002/69404783-108a0880-0d39-11ea-8f84-416820ec0231.png)

4. 灰度完成后，将staging中的target revision修改为v3.0.0，同步，状态就是和代码仓库中的预期一样。
**有个注意的地方，上一个版本的deploy需要手动删除，如下图所示。**
![img](https://user-images.githubusercontent.com/3350002/69404874-4b8c3c00-0d39-11ea-9dd6-6821bedd8391.png)

5. canary版本的application也手动同步，replicas和代码仓库提交的一样，为0。

## 一个重点，创建app的时候同步方式切记不能设置为自动同步。否则界面修改就无效了，会瞬间被同步。

## 回滚
argocd本身提供了回滚机制，但是这个回滚以后由于target version的版本号已经修改为最新的，如果不小心同步那么又是最新版本。所以灰度建议通过修改target version的版本号，同时手动删除新版本的deploy来实现。
部署配置的版本通过gitlab管理了，实际上想回滚到哪个版本都行。极其方便且安全。

## 用户权限控制
上面说了，argocd默认只有一个admin用户，但不可能把这个用户开放给所有人，所幸[支持sso登录](https://argoproj.github.io/argo-cd/operator-manual/sso/)。

但我验证了使用公司的统一认证并没有成功，关于这个文档也只有一段描述，未完待续
