{{- if and .Values.buildkit.enabled (eq .Values.platform.startupStage "full") }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "compartment.fullname" . }}-buildkit
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
spec:
  selector:
    {{- include "compartment.componentLabels" (dict "root" . "component" "buildkit") | nindent 4 }}
  ports:
    - name: buildkit
      port: {{ .Values.ports.buildkit }}
      targetPort: buildkit
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "compartment.fullname" . }}-buildkit
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
    app.kubernetes.io/component: buildkit
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "compartment.componentLabels" (dict "root" . "component" "buildkit") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "compartment.componentLabels" (dict "root" . "component" "buildkit") | nindent 8 }}
    spec:
      {{- include "compartment.waiterPodSpec" . | nindent 6 }}
      securityContext:
        seccompProfile:
          {{- toYaml .Values.buildkit.seccompProfile | nindent 10 }}
        fsGroup: 1000
        fsGroupChangePolicy: OnRootMismatch
      initContainers:
        {{- include "compartment.waitForMigrationInit" . | nindent 8 }}
      containers:
        - name: buildkit
          image: {{ include "compartment.image" .Values.images.buildkit }}
          imagePullPolicy: {{ .Values.images.buildkit.pullPolicy }}
          args:
            - --addr
            - tcp://0.0.0.0:{{ .Values.ports.buildkit }}
            - --oci-worker-no-process-sandbox
          securityContext:
            allowPrivilegeEscalation: true
            appArmorProfile:
              type: Unconfined
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 1000
            runAsGroup: 1000
          resources:
            {{- toYaml .Values.resources.buildkit | nindent 12 }}
          env:
            - name: HOME
              value: /home/user
            - name: XDG_RUNTIME_DIR
              value: /run/user/1000
          ports:
            - name: buildkit
              containerPort: {{ .Values.ports.buildkit }}
          readinessProbe:
            tcpSocket:
              port: buildkit
            periodSeconds: 2
          volumeMounts:
            - name: data
              mountPath: /home/user/.local/share/buildkit
            - name: rootless-tmp
              mountPath: /home/user/.local/tmp
            - name: run
              mountPath: /run/user/1000
            - name: tmp
              mountPath: /tmp
      volumes:
        {{- include "compartment.kubeApiAccessVolume" . | nindent 8 }}
        - name: data
          persistentVolumeClaim:
            claimName: {{ include "compartment.fullname" . }}-buildkit
        - name: run
          emptyDir: {}
        - name: rootless-tmp
          emptyDir: {}
        - name: tmp
          emptyDir: {}
{{- end }}
