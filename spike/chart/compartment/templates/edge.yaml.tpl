apiVersion: v1
kind: Service
metadata:
  name: {{ include "compartment.fullname" . }}-edge
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
spec:
  selector:
    {{- include "compartment.componentLabels" (dict "root" . "component" "edge") | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.ports.edge }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "compartment.fullname" . }}-edge
  labels:
    {{- include "compartment.labels" . | nindent 4 }}
    app.kubernetes.io/component: edge
spec:
  replicas: 1
  selector:
    matchLabels:
      {{- include "compartment.componentLabels" (dict "root" . "component" "edge") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "compartment.componentLabels" (dict "root" . "component" "edge") | nindent 8 }}
      annotations:
        {{- include "compartment.rolloutAnnotations" . | nindent 8 }}
    spec:
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: edge
          image: {{ include "compartment.image" .Values.images.edge }}
          imagePullPolicy: {{ .Values.images.edge.pullPolicy }}
          securityContext:
            {{- include "compartment.containerSecurityContext" . | nindent 12 }}
            runAsUser: 1000
            runAsGroup: 1000
          envFrom:
            - configMapRef:
                name: {{ include "compartment.fullname" . }}
          env:
            - name: COMPARTMENT_EDGE_TOKEN
              valueFrom:
                secretKeyRef: {name: {{ include "compartment.fullname" . }}, key: edge-token}
          ports:
            - name: http
              containerPort: {{ .Values.ports.edge }}
          readinessProbe:
            httpGet: {path: /healthz, port: http}
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:
            httpGet: {path: /healthz, port: http}
            initialDelaySeconds: 10
            periodSeconds: 10
          volumeMounts:
            - {name: tmp, mountPath: /tmp}
      volumes:
        - {name: tmp, emptyDir: {}}
