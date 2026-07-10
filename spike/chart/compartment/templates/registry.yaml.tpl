apiVersion: v1
kind: Service
metadata:
  name: {{ include "compartment.fullname" . }}-registry
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
spec:
  selector:
    {{- include "compartment.componentLabels" (dict "root" . "component" "registry") | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.ports.registry }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "compartment.fullname" . }}-registry
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
    app.kubernetes.io/component: registry
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "compartment.componentLabels" (dict "root" . "component" "registry") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "compartment.componentLabels" (dict "root" . "component" "registry") | nindent 8 }}
    spec:
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
        fsGroup: 1000
        fsGroupChangePolicy: OnRootMismatch
      containers:
        - name: registry
          image: {{ include "compartment.image" .Values.images.registry }}
          imagePullPolicy: {{ .Values.images.registry.pullPolicy }}
          securityContext:
            {{- include "compartment.containerSecurityContext" . | nindent 12 }}
            runAsUser: 1000
            runAsGroup: 1000
          env:
            - name: REGISTRY_HTTP_ADDR
              value: {{ printf "0.0.0.0:%v" .Values.ports.registry | quote }}
            - name: REGISTRY_HTTP_RELATIVEURLS
              value: "true"
            - name: REGISTRY_STORAGE_DELETE_ENABLED
              value: "true"
          ports:
            - name: http
              containerPort: {{ .Values.ports.registry }}
          readinessProbe:
            httpGet:
              path: /v2/
              port: http
            periodSeconds: 2
          volumeMounts:
            - name: data
              mountPath: /var/lib/registry
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: {{ include "compartment.fullname" . }}-registry
        - name: tmp
          emptyDir: {}
