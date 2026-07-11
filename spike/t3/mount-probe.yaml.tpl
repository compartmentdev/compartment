apiVersion: v1
kind: Pod
metadata:
  name: NAME
  namespace: cpt-t3-stateful
  labels:
    spike.compartment.dev/track: t3
spec:
  nodeName: NODE
  containers:
    - name: probe
      image: busybox:1.37.0
      command: [sh, -c, "while true; do echo NAME:$(date -u +%s%N) >> /data/concurrent-writers; sleep 0.1; done"]
      volumeMounts:
        - {name: data, mountPath: /data}
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: postgres-data
